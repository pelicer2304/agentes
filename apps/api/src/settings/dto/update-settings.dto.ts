import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsString()
  @IsNotEmpty({ message: 'agentName is required' })
  @MaxLength(100)
  agentName!: string;

  @IsString()
  @IsNotEmpty({ message: 'initialMessage is required' })
  @MaxLength(500)
  initialMessage!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  toneOfVoice?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  services?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  doNotPromise?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  handoffCriteria?: string[];
}
