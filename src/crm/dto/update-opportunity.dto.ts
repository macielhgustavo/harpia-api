import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateOpportunityDto {
  @IsOptional()
  @IsString()
  personId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string | null;

  @IsOptional()
  @IsString()
  developmentId?: string | null;

  @IsOptional()
  @IsString()
  unitId?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  source?: string | null;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  estimatedValue?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number | null;

  @IsOptional()
  @IsDateString()
  nextContactAt?: string | null;

  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}
