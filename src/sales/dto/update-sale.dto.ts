import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateSaleDto {
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9._/-]{1,50}$/)
  saleNumber?: string;

  @IsOptional()
  @IsDateString()
  saleDate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
