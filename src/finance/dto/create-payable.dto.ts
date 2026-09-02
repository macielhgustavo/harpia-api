import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsDecimal,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePayableDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;

  @IsDateString()
  dueDate!: string;

  @Transform(trim)
  @IsDecimal({ decimal_digits: '1,2', force_decimal: false })
  @Matches(/^[1-9]\d{0,15}(?:\.\d{1,2})?$|^0\.(?:0[1-9]|[1-9]\d)$/)
  originalAmount!: string;

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
  bankAccountId?: string;

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
}
