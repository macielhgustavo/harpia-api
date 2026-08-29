import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSaleCommissionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  personId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  userId?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^(?:100(?:\.0{1,2})?|(?:[1-9]\d?)(?:\.\d{1,2})?)$/)
  percentage?: string;

  @Transform(trim)
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  amount!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
