import {
  SalesActivityPriority,
  SalesActivityStatus,
  SalesActivityType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListSalesActivitiesQueryDto {
  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  personId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsEnum(SalesActivityType)
  type?: SalesActivityType;

  @IsOptional()
  @IsEnum(SalesActivityStatus)
  status?: SalesActivityStatus;

  @IsOptional()
  @IsEnum(SalesActivityPriority)
  priority?: SalesActivityPriority;

  @IsOptional()
  @IsDateString()
  scheduledFrom?: string;

  @IsOptional()
  @IsDateString()
  scheduledTo?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  openOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
