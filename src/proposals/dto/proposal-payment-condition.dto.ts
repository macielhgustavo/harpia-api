import { Transform, Type } from 'class-transformer';
import { ProposalPaymentConditionType } from '@prisma/client';
import {
  IsDateString,
  IsDecimal,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ProposalPaymentConditionDto {
  @IsEnum(ProposalPaymentConditionType)
  type!: ProposalPaymentConditionType;

  @Transform(trim)
  @IsDecimal({ decimal_digits: '1,2', force_decimal: false })
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  amount!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  installments?: number;

  @IsOptional()
  @IsDateString()
  firstDueDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  intervalMonths?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;
}
