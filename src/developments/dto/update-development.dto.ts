import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateDevelopmentDto } from './create-development.dto';

export class UpdateDevelopmentDto extends PartialType(
  OmitType(CreateDevelopmentDto, [
    'expectedLaunchDate',
    'expectedDeliveryDate',
  ] as const),
) {
  @IsOptional()
  @IsDateString()
  expectedLaunchDate?: string | null;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string | null;
}
