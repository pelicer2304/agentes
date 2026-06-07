import { IsIn, IsOptional, IsString, IsNumberString } from 'class-validator';
import { LEAD_STATUSES } from './update-lead-status.dto';

const TEMPERATURES = ['frio', 'morno', 'quente'] as const;

export class LeadFilterDto {
  @IsOptional()
  @IsString()
  @IsIn([...LEAD_STATUSES], {
    message: `status must be one of: ${LEAD_STATUSES.join(', ')}`,
  })
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn([...TEMPERATURES], {
    message: `temperature must be one of: ${TEMPERATURES.join(', ')}`,
  })
  temperature?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  pageSize?: string;
}
