import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for creating a new playground conversation.
 * No required fields - the system creates a default Lead and Conversation.
 */
export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}
