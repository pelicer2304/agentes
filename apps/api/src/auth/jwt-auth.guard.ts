import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard that protects routes using the Passport JWT strategy.
 *
 * Returns 401 Unauthorized when the bearer token is missing, malformed,
 * expired, or otherwise invalid. On success, the authenticated user
 * (as returned by {@link JwtStrategy.validate}) is attached to `request.user`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
