import { SetMetadata } from '@nestjs/common';
import { UserRole } from './auth.types';

/** Metadata key under which the required roles for a route are stored. */
export const ROLES_KEY = 'roles';

/**
 * Restricts a route handler (or controller) to the given user roles.
 *
 * Used together with {@link RolesGuard}. When no roles are supplied the
 * route is accessible to any authenticated user.
 *
 * @example
 * ```ts
 * @Roles('admin')
 * @Get('admin-only')
 * adminOnly() {}
 * ```
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
