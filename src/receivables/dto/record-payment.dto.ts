import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsDecimal,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RecordPaymentDto {
  @Transform(trim)
  @IsDecimal({ decimal_digits: '1,2', force_decimal: false })
  @Matches(/^(?:0\.(?:0[1-9]|[1-9]\d)|[1-9]\d{0,15}(?:\.\d{1,2})?)$/)
  amount!: string;

  @IsDateString()
  paidAt!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
