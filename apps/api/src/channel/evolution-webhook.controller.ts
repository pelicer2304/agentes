// import { Controller, Post, Body } from '@nestjs/common';
// import { EvolutionChannelAdapter } from './evolution-channel.adapter';
//
// /**
//  * Webhook controller for receiving WhatsApp messages from Evolution API.
//  *
//  * This controller is a placeholder for future implementation.
//  * When enabled, it will:
//  * - Receive POST requests from Evolution API at /webhooks/evolution
//  * - Validate the webhook payload
//  * - Pass the payload to EvolutionChannelAdapter.receiveMessage()
//  * - Trigger the agent processing pipeline
//  *
//  * Required env vars:
//  *   - EVOLUTION_API_URL
//  *   - EVOLUTION_API_KEY
//  *   - EVOLUTION_INSTANCE_NAME
//  */
// @Controller('webhooks')
// export class EvolutionWebhookController {
//   constructor(private readonly evolutionAdapter: EvolutionChannelAdapter) {}
//
//   @Post('evolution')
//   async handleWebhook(@Body() payload: unknown): Promise<{ ok: boolean }> {
//     const message = await this.evolutionAdapter.receiveMessage(payload);
//     // TODO: Forward message to ConversationService for processing
//     return { ok: true };
//   }
// }
