import { Injectable } from '@nestjs/common';

/**
 * Tunable parameters for the {@link RateLimiterService} token bucket.
 */
export interface RateLimiterOptions {
  /** Maximum number of tokens a bucket can hold (burst size). */
  capacity: number;
  /** The window, in milliseconds, over which `capacity` tokens fully refill. */
  refillIntervalMs: number;
}

/**
 * Default per-phone limit: 10 inbound messages per 30 seconds.
 *
 * Chosen as a generous-but-bounded MVP default that tolerates a normal back and
 * forth burst while dropping clearly abusive flooding (Requirement 18.5).
 */
export const DEFAULT_RATE_LIMITER_OPTIONS: RateLimiterOptions = {
  capacity: 10,
  refillIntervalMs: 30_000,
};

/** Internal per-key bucket state. */
interface Bucket {
  /** Current (possibly fractional) token count. */
  tokens: number;
  /** Timestamp (ms) of the last refill calculation. */
  lastRefill: number;
}

/**
 * In-memory, per-key token-bucket rate limiter (Requirement 18.5).
 *
 * Keyed by phone number in the inbound WhatsApp pipeline: each phone gets its
 * own bucket that refills continuously at `capacity / refillIntervalMs` tokens
 * per millisecond. {@link tryConsume} removes one token and returns whether the
 * call is allowed; when the bucket is empty the inbound is over the limit and
 * the caller drops it (after logging) without invoking the engine.
 *
 * ## Redis note (MVP)
 * This is an in-memory implementation, which is sufficient for a single API
 * instance (the MVP target). For a multi-instance / horizontally-scaled
 * deployment the bucket state should live in Redis (shared across instances)
 * when `REDIS_URL` is configured. The public surface ({@link tryConsume}) is
 * intentionally synchronous-friendly so a Redis-backed implementation can be
 * swapped in behind the same `RateLimiterService` token without touching call
 * sites. Redis support is intentionally out of scope for this task.
 */
@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillIntervalMs: number;

  constructor(options: RateLimiterOptions = DEFAULT_RATE_LIMITER_OPTIONS) {
    this.capacity = Math.max(1, options.capacity);
    this.refillIntervalMs = Math.max(1, options.refillIntervalMs);
  }

  /**
   * Attempt to consume a single token for `key`.
   *
   * @param key - The bucket key (the sender phone number in the inbound flow).
   * @param now - Optional injected clock (ms) for deterministic testing;
   *              defaults to `Date.now()`.
   * @returns `true` when a token was available and consumed (call allowed);
   *          `false` when the bucket is empty (call must be dropped).
   */
  tryConsume(key: string, now: number = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefill: now,
    };

    // Continuously refill based on elapsed time since the last calculation.
    const elapsed = Math.max(0, now - bucket.lastRefill);
    const refillRate = this.capacity / this.refillIntervalMs; // tokens per ms
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    let allowed = false;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      allowed = true;
    }

    this.buckets.set(key, bucket);
    return allowed;
  }

  /**
   * Remove all bucket state. Primarily a test/maintenance hook.
   */
  reset(): void {
    this.buckets.clear();
  }
}
