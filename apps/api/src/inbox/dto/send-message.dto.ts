import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /inbox/:id/mensagem — a Team_Member's manual message
 * (Requirements 13.1, 13.2, 13.3).
 */
export class SendMessageDto {
  /** Non-empty message body to deliver to the client. */
  @IsString()
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(10000, { message: 'content must be at most 10000 characters' })
  content!: string;
}
