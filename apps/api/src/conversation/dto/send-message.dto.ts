import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO for sending a message in a conversation.
 * Content must be between 1 and 4000 characters.
 */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'Message content must not be empty' })
  @MinLength(1, { message: 'Message content must be at least 1 character' })
  @MaxLength(4000, { message: 'Message content must not exceed 4000 characters' })
  content!: string;
}
