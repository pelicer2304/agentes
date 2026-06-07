import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { InboxService } from './inbox.service';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Conversations Inbox API.
 *
 * Protected at the controller level by {@link JwtAuthGuard} so that only
 * authenticated team members (admin/atendente) can read conversations
 * (Requirement 20.2).
 *
 * Listing and detail are implemented here (Task 10.1). Mutating actions
 * (takeover, pause/resume, convert/lost, manual send) are added by tasks
 * 10.2/10.3 on the same controller.
 */
@Controller('inbox')
@UseGuards(JwtAuthGuard)
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  /**
   * GET /inbox
   * Lists WhatsApp conversations with last message and lead state,
   * ordered by most recent activity (Requirements 16.1, 16.5).
   */
  @Get()
  async list() {
    return this.inboxService.list();
  }

  /**
   * GET /inbox/:id
   * Returns the full chat plus the lead side panel for a conversation
   * (Requirements 16.2, 16.3, 16.6).
   */
  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.inboxService.getDetail(id);
  }

  /**
   * POST /inbox/:id/assumir
   * Team_Member takes over the conversation: pauses the bot, assigns it to
   * the acting member, and moves status to aguardando_humano/chamar_humano,
   * recording a bot_paused event (Requirements 12.1, 12.3, 16.4).
   */
  @Post(':id/assumir')
  async takeover(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.inboxService.takeover(id, this.actingUserId(req));
  }

  /**
   * POST /inbox/:id/pausar
   * Pauses the bot for the conversation, recording a bot_paused event
   * (Requirements 12.1, 12.3).
   */
  @Post(':id/pausar')
  async pause(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inboxService.pauseBot(id, this.actingUserId(req));
  }

  /**
   * POST /inbox/:id/retomar
   * Resumes the bot for the conversation, recording a bot_resumed event
   * (Requirements 12.2, 12.4).
   */
  @Post(':id/retomar')
  async resume(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inboxService.resumeBot(id, this.actingUserId(req));
  }

  /**
   * POST /inbox/:id/converter
   * Marks the conversation's lead as converted (Requirement 16.4).
   */
  @Post(':id/converter')
  async convert(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inboxService.markConverted(id, this.actingUserId(req));
  }

  /**
   * POST /inbox/:id/perdido
   * Marks the conversation's lead as lost (Requirement 16.4).
   */
  @Post(':id/perdido')
  async lost(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inboxService.markLost(id, this.actingUserId(req));
  }

  /**
   * POST /inbox/:id/mensagem
   * Sends a manual Team_Member message to the client via Evolution_Service.
   * On success persists an outbound Message attributed to the team and records
   * a human_message_sent event; on failure reports the error to the team and
   * records an evolution_error event (Requirements 13.1, 13.2, 13.3).
   */
  @Post(':id/mensagem')
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.inboxService.sendManualMessage(
      id,
      this.actingUserId(req),
      body.content,
    );
  }

  /**
   * Reads the acting Team_Member id from the JWT-authenticated request.
   * {@link JwtStrategy.validate} attaches `{ userId, email, role }`.
   */
  private actingUserId(req: Request): string {
    return (req.user as AuthenticatedUser).userId;
  }
}
