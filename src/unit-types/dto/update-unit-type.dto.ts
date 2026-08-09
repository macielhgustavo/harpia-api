import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// developmentId não muda no update — a tipologia pertence ao empreendimento onde foi criada.
export class UpdateUnitTypeDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  suites?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  standardArea?: number | null;
}
