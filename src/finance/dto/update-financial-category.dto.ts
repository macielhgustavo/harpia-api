import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateFinancialCategoryDto } from './create-financial-category.dto';

export class UpdateFinancialCategoryDto extends PartialType(
  CreateFinancialCategoryDto,
) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
