import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('playground/conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  /**
   * POST /playground/conversations
   * Creates a new playground conversation with a new Lead and initial greeting.
   */
  @Post()
  async createConversation() {
    return this.conversationService.createConversation();
  }

  /**
   * POST /playground/conversations/:id/messages
   * Sends a user message and receives the agent's response.
   */
  @Post(':id/messages')
  async sendMessage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.conversationService.handleInboundMessage(id, body.content);
  }

  /**
   * GET /playground/conversations/:id
   * Gets a conversation with messages and latest analysis.
   */
  @Get(':id')
  async getConversation(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.conversationService.getConversation(id);
  }

  /**
   * DELETE /playground/conversations/:id/clear
   * Clears the conversation history and resets the session (same lead, fresh start).
   */
  @Delete(':id/clear')
  async clearConversation(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.conversationService.clearConversation(id);
  }

  /**
   * POST /playground/clear
   * Clears all active conversations and starts fresh.
   */
  @Post('clear')
  async clearAll() {
    return this.conversationService.clearAllAndRestart();
  }
}
