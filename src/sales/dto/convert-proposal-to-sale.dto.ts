import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateSaleCommissionDto } from './create-sale-commission.dto';
import { SaleBuyerDto } from './sale-buyer.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ConvertProposalToSaleDto {
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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SaleBuyerDto)
  buyers!: SaleBuyerDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleCommissionDto)
  commissions?: CreateSaleCommissionDto[];
}
