import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCollectionRuleDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(-365)
  @Max(365)
  daysOffset!: number;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  subject!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
