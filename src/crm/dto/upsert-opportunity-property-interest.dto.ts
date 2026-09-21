import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { PropertyInterestPurpose } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const OptionalId = () =>
  applyDecorators(IsOptional(), Transform(trim), IsString(), MaxLength(191));

const OptionalMoney = () =>
  applyDecorators(
    IsOptional(),
    Transform(trim),
    Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/),
  );

export class UpsertOpportunityPropertyInterestDto {
  @OptionalId()
  developmentId?: string | null;

  @OptionalId()
  unitTypeId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minBedrooms?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxBedrooms?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minArea?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxArea?: number | null;

  @OptionalMoney()
  minPrice?: string | null;

  @OptionalMoney()
  maxPrice?: string | null;

  @OptionalMoney()
  availableDownPayment?: string | null;

  @IsOptional()
  @IsEnum(PropertyInterestPurpose)
  purpose?: PropertyInterestPurpose | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
