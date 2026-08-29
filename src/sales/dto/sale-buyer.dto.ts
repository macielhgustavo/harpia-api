import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SaleBuyerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  personId!: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^(?:100(?:\.0{1,2})?|(?:[1-9]\d?)(?:\.\d{1,2})?)$/)
  participationPercentage?: string;

  @IsBoolean()
  isPrimary!: boolean;
}
