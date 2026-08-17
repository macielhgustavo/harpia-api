import { SalesActivityType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateSalesActivityDto {
  @IsOptional()
  @IsString()
  assignedUserId?: string | null;

  @IsOptional()
  @IsEnum(SalesActivityType)
  type?: SalesActivityType;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsDateString()
  completedAt?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  summary?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}
