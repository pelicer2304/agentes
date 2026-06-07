import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Payload for the admin-only `POST /channels/evolution/send-test-message`
 * endpoint. Sends a plain text message through Evolution_API to verify the
 * WhatsApp integration end-to-end.
 */
export class SendTestMessageDto {
  /** Destination phone number (digits, channel format). */
  @IsString()
  @MinLength(1, { message: 'to must not be empty' })
  to!: string;

  /**
   * Optional message body. When omitted, a default test message is sent
   * (see {@link DEFAULT_TEST_MESSAGE}).
   */
  @IsOptional()
  @IsString()
  text?: string;
}

/** Default message sent when the request omits `text`. */
export const DEFAULT_TEST_MESSAGE =
  'Test message from the WhatsApp integration.';
