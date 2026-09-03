import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { BankStatementEntryType } from '@prisma/client';

export class ImportBankStatementEntryDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  externalId?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsString()
  @Length(1, 300)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description!: string;

  @IsEnum(BankStatementEntryType)
  type!: BankStatementEntryType;

  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  amount!: string;
}

export class ImportBankStatementDto {
  @IsString()
  bankAccountId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportBankStatementEntryDto)
  entries!: ImportBankStatementEntryDto[];
}
