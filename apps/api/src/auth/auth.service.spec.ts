import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('returns the authenticated user when credentials match', async () => {
      const passwordHash = await bcrypt.hash('secret123', 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        passwordHash,
        role: 'admin',
      });

      const result = await service.validateUser('admin@example.com', 'secret123');

      expect(result).toEqual({
        userId: 'user-1',
        email: 'admin@example.com',
        role: 'admin',
      });
    });

    it('returns null when the user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('missing@example.com', 'whatever');

      expect(result).toBeNull();
    });

    it('returns null when the password does not match', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        passwordHash,
        role: 'admin',
      });

      const result = await service.validateUser('admin@example.com', 'wrong-password');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('issues a JWT with the { sub, email, role } payload on success', async () => {
      const passwordHash = await bcrypt.hash('secret123', 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        passwordHash,
        role: 'admin',
      });
      mockJwtService.signAsync.mockResolvedValue('signed.jwt.token');

      const result = await service.login('admin@example.com', 'secret123');

      expect(mockJwtService.signAsync).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'admin@example.com',
        role: 'admin',
      });
      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        user: { id: 'user-1', email: 'admin@example.com', role: 'admin' },
      });
    });

    it('throws 401 when credentials are invalid', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('admin@example.com', 'bad'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});
