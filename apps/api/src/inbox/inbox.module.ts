import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EvolutionModule } from '../modules/channels/evolution/evolution.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

/**
 * Module backing the Conversations Inbox screen.
 *
 * Imports {@link AuthModule} so the {@link JwtAuthGuard} can resolve its
 * dependencies, {@link EvolutionModule} so {@link InboxService} can inject
 * {@link EvolutionService} for manual sends, and relies on the
 * globally-provided {@link PrismaModule}.
 */
@Module({
  imports: [PrismaModule, AuthModule, EvolutionModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
