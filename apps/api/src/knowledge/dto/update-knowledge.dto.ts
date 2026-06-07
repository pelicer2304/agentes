import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for updating an existing KnowledgeBase item.
 * All fields are optional.
 */
export class UpdateKnowledgeDto {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Category must not exceed 50 characters' })
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Content must not exceed 5000 characters' })
  content?: string;

  @IsOptional()
  @IsBoolean({ message: 'Active must be a boolean' })
  active?: boolean;
}
