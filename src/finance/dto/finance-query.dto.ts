import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const CASH_FLOW_MODES = [
  'REALIZADO',
  'PROJETADO',
  'CONSOLIDADO',
] as const;
export const CASH_FLOW_GROUPS = ['DIA', 'SEMANA', 'MES'] as const;

export class FinanceQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  developmentId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsIn(CASH_FLOW_MODES)
  mode?: (typeof CASH_FLOW_MODES)[number];

  @IsOptional()
  @IsIn(CASH_FLOW_GROUPS)
  groupBy?: (typeof CASH_FLOW_GROUPS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;
}
