import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateReceivableAdjustmentPolicyDto {
  @IsString()
  monetaryIndexId: string;

  @IsDateString()
  baseDate: string;

  @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY'])
  periodicity: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  lag?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
