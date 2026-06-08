import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ensures an initial admin user exists so the dashboard is loginable right
 * after a fresh deploy (the production image runs `prisma migrate deploy` but
 * NOT the dev-only `prisma db seed`, so we seed the admin here on boot).
 *
 * Idempotent: only creates the admin when no user with the configured email
 * exists; it never overwrites an existing user's password. Configure via
 * `ADMIN_EMAIL` / `ADMIN_PASSWORD` (defaults: admin@decodifica.com / changeme123).
 * A failure here is logged but never blocks API startup.
 */
@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const email = process.env.ADMIN_EMAIL || 'admin@decodifica.com';
    const password = process.env.ADMIN_PASSWORD || 'changeme123';

    // Em produção, recusar subir com senha de admin ausente ou no default
    // ("changeme123"): isso evita um admin trivialmente acessível num deploy
    // real. Lançar aqui aborta o boot (o catch do bootstrap encerra o processo).
    // Em desenvolvimento o default segue valendo para conveniência local.
    if (
      process.env.APP_ENV === 'production' &&
      (!process.env.ADMIN_PASSWORD || password === 'changeme123')
    ) {
      throw new Error(
        'ADMIN_PASSWORD ausente ou ainda no default "changeme123" em produção. ' +
          'Defina uma senha de admin forte (variável ADMIN_PASSWORD) antes de subir.',
      );
    }

    try {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        this.logger.log(`Admin user already present: ${email}`);
        return;
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await this.prisma.user.create({
        data: { email, passwordHash, role: 'admin' },
      });
      this.logger.log(`Seeded initial admin user: ${email}`);
    } catch (err) {
      this.logger.error(
        `Admin bootstrap failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
