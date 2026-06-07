import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO for creating a new KnowledgeBase item.
 * All fields are required with max length constraints.
 */
export class CreateKnowledgeDto {
  @IsString()
  @IsNotEmpty({ message: 'Category must not be empty' })
  @MaxLength(50, { message: 'Category must not exceed 50 characters' })
  category!: string;

  @IsString()
  @IsNotEmpty({ message: 'Title must not be empty' })
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'Content must not be empty' })
  @MaxLength(5000, { message: 'Content must not exceed 5000 characters' })
  content!: string;
}
