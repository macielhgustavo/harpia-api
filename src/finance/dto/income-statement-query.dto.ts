import { IsIn, IsOptional } from 'class-validator';
import { FinanceQueryDto } from './finance-query.dto';

export const INCOME_STATEMENT_BASES = ['COMPETENCIA', 'CAIXA'] as const;

export class IncomeStatementQueryDto extends FinanceQueryDto {
  @IsOptional()
  @IsIn(INCOME_STATEMENT_BASES)
  basis?: (typeof INCOME_STATEMENT_BASES)[number];
}
