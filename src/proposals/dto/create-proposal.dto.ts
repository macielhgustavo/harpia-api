import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDecimal,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProposalPaymentConditionDto } from './proposal-payment-condition.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProposalDto {
  @IsString()
  @IsNotEmpty()
  personId!: string;

  @IsString()
  @IsNotEmpty()
  unitId!: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  reservationId?: string;

  @Transform(trim)
  @IsDecimal({ decimal_digits: '1,2', force_decimal: false })
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  discount!: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ProposalPaymentConditionDto)
  conditions!: ProposalPaymentConditionDto[];
}
