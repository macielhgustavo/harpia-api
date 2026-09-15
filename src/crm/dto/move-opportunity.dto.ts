import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_LOST_REASON_LENGTH } from '../opportunity-stage';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class MoveOpportunityDto {
  @IsString()
  stageId: string;

  /** Free text for now; the structured catalogue is CRM-023, still pending. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_LOST_REASON_LENGTH)
  lostReason?: string;
}
