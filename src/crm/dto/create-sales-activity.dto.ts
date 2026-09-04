import {
  SalesActivityPriority,
  SalesActivityStatus,
  SalesActivityType,
} from '@prisma/client';
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

export class CreateSalesActivityDto {
  @IsString()
  opportunityId: string;

  @IsOptional()
  @IsString()
  personId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsEnum(SalesActivityType)
  type: SalesActivityType;

  @IsOptional()
  @IsEnum(SalesActivityStatus)
  status?: SalesActivityStatus;

  @IsOptional()
  @IsEnum(SalesActivityPriority)
  priority?: SalesActivityPriority;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsDateString()
  reminderAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  summary?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  result?: string;
}
