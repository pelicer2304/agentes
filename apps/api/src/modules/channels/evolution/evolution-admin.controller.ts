import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { EvolutionService } from './evolution.service';
import { DEFAULT_TEST_MESSAGE, SendTestMessageDto } from './dto/send-test-message.dto';

/**
 * Admin-only HTTP surface for operating the Evolution_API (WhatsApp) instance
 * (Requirements 20.5, 21.4).
 *
 * Every route is protected at the controller level by {@link JwtAuthGuard}
 * (valid bearer token required) and {@link RolesGuard} restricted to the
 * `admin` role. All handlers delegate to {@link EvolutionService}, which
 * returns key-safe {@link EvolutionResult} values, so responses never leak the
 * `EVOLUTION_API_KEY`.
 */
@Controller('channels/evolution')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class EvolutionAdminController {
  constructor(private readonly evolutionService: EvolutionService) {}

  /**
   * Return the current connection state of the configured Evolution instance.
   */
  @Get('status')
  getStatus() {
    return this.evolutionService.getInstanceStatus();
  }

  /**
   * Configure the Evolution webhook to point at this application.
   */
  @Post('set-webhook')
  setWebhook() {
    return this.evolutionService.setWebhook();
  }

  /**
   * Send a test text message through Evolution_API to verify the integration.
   * Falls back to a default message body when `text` is omitted.
   */
  @Post('send-test-message')
  sendTestMessage(@Body() dto: SendTestMessageDto) {
    return this.evolutionService.sendTextMessage(
      dto.to,
      dto.text ?? DEFAULT_TEST_MESSAGE,
    );
  }
}
