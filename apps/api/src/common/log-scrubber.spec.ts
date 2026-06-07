import fc from 'fast-check';
import { LogScrubberService, SECRET_MASK, scrubSecrets } from './log-scrubber';
import type { AppConfigService } from '../config/config.service';

describe('scrubSecrets', () => {
  it('replaces every occurrence of a secret with the mask', () => {
    const out = scrubSecrets('key=ABC and again ABC end', ['ABC']);
    expect(out).toBe(`key=${SECRET_MASK} and again ${SECRET_MASK} end`);
  });

  it('masks multiple distinct secrets', () => {
    const out = scrubSecrets('api=SECRET1 jwt=SECRET2', ['SECRET1', 'SECRET2']);
    expect(out).toBe(`api=${SECRET_MASK} jwt=${SECRET_MASK}`);
  });

  it('ignores empty and whitespace-only secrets to avoid masking everything', () => {
    const message = 'nothing sensitive here';
    expect(scrubSecrets(message, ['', '   '])).toBe(message);
  });

  it('returns the message unchanged when no secret is present', () => {
    expect(scrubSecrets('plain log line', ['NOPE'])).toBe('plain log line');
  });

  it('coerces a non-string message before scrubbing', () => {
    // @ts-expect-error intentionally passing a non-string to verify coercion
    expect(scrubSecrets(42, ['NOPE'])).toBe('42');
  });

  it('scrubs the EVOLUTION_API_KEY and JWT_SECRET style values', () => {
    const evoKey = 'evo-9f3a-key';
    const jwt = 'jwt-super-secret';
    const log = `request failed with apikey ${evoKey}; token ${jwt}`;
    const out = scrubSecrets(log, [evoKey, jwt]);
    expect(out).not.toContain(evoKey);
    expect(out).not.toContain(jwt);
    expect(out).toBe(`request failed with apikey ${SECRET_MASK}; token ${SECRET_MASK}`);
  });

  // Feature: whatsapp-evolution-production
  // Property: a non-empty secret embedded in any surrounding text never
  // survives scrubbing verbatim.
  it('never leaves a non-empty secret verbatim in the output', () => {
    // Realistic credential alphabet: the mask ('***') must not be able to
    // reconstruct the secret, so exclude '*' from generated secret values.
    const secretArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim().length > 0 && !s.includes('*'));

    fc.assert(
      fc.property(fc.string(), secretArb, fc.string(), (prefix, secret, suffix) => {
        const message = `${prefix}${secret}${suffix}`;
        const scrubbed = scrubSecrets(message, [secret]);
        // Since the secret contains no '*', the inserted mask can never
        // reconstruct it; absence in the output is a valid invariant.
        expect(scrubbed.includes(secret)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('LogScrubberService', () => {
  function makeService(evolutionApiKey: string, jwtSecret: string): LogScrubberService {
    const config = { evolutionApiKey, jwtSecret } as unknown as AppConfigService;
    return new LogScrubberService(config);
  }

  it('masks the configured Evolution key and JWT secret in strings', () => {
    const service = makeService('evo-key-123', 'jwt-secret-456');
    const out = service.scrub('url with evo-key-123 and jwt-secret-456');
    expect(out).toBe(`url with ${SECRET_MASK} and ${SECRET_MASK}`);
  });

  it('scrubs secrets from an Error message', () => {
    const service = makeService('evo-key-123', 'jwt-secret-456');
    const out = service.scrubError(new Error('boom with evo-key-123'));
    expect(out).not.toContain('evo-key-123');
    expect(out).toContain(SECRET_MASK);
  });

  it('handles non-Error thrown values safely', () => {
    const service = makeService('evo-key-123', 'jwt-secret-456');
    expect(service.scrubError('plain string error')).toBe('plain string error');
  });
});
