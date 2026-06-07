export const USER_ROLES = ['admin', 'atendente'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Payload encoded inside the issued JWT. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/** Shape returned by the JWT strategy and attached to the request as the authenticated user. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
}

/** Successful login response. */
export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
  };
}
