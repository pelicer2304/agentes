import { IsIn, IsString } from 'class-validator';

export const LEAD_STATUSES = [
  'novo',
  'qualificando',
  'frio',
  'morno',
  'quente',
  'chamar_humano',
  'convertido',
  'perdido',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export class UpdateLeadStatusDto {
  @IsString()
  @IsIn(LEAD_STATUSES, {
    message: `status must be one of: ${LEAD_STATUSES.join(', ')}`,
  })
  status!: LeadStatus;
}
