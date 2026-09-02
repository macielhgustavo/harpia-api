import { FinancialCategoryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateFinancialCategoryDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEnum(FinancialCategoryType)
  type!: FinancialCategoryType;
}
