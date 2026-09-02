import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PAYABLE_FILTER_STATUSES = [
  'PENDENTE',
  'PARCIAL',
  'PAGO',
  'ATRASADO',
  'CANCELADO',
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListPayablesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(PAYABLE_FILTER_STATUSES)
  status?: (typeof PAYABLE_FILTER_STATUSES)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  companyId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  developmentId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  supplierPersonId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  search?: string;
}
