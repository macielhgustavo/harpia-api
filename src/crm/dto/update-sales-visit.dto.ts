import { SalesVisitOutcome, SalesVisitStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateSalesVisitDto {
  @IsOptional()
  @IsString()
  assignedUserId?: string | null;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsEnum(SalesVisitStatus)
  status?: SalesVisitStatus;

  @IsOptional()
  @IsEnum(SalesVisitOutcome)
  outcome?: SalesVisitOutcome | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  result?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  cancellationReason?: string | null;
}
