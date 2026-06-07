import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthenticatedUser,
  JwtPayload,
  LoginResult,
  UserRole,
} from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Validates the supplied credentials against the stored user record.
   * Returns the authenticated user on success, or null when the email is
   * unknown or the password does not match.
   */
  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return null;
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
    };
  }

  /**
   * Authenticates the credentials and issues a signed JWT.
   * Throws 401 when the credentials are invalid.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.validateUser(email, password);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = {
      sub: user.userId,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.userId,
        email: user.email,
        role: user.role,
      },
    };
  }
}
