import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateSalesStageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  code: string;

  @IsInt()
  @Min(0)
  position: number;

  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,29}$/)
  colorKey: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  defaultProbability?: number;

  @IsOptional()
  @IsBoolean()
  isWon?: boolean;

  @IsOptional()
  @IsBoolean()
  isLost?: boolean;
}

export class CreateSalesPipelineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesStageDto)
  stages?: CreateSalesStageDto[];
}
