import { IsDateString, IsOptional, IsNumber, MaxLength } from 'class-validator';

export class CreateMonetaryIndexValueDto {
  @IsDateString()
  competence: string; // YYYY-MM-DD

  @IsNumber()
  percentage: number; // e.g., 0.0075 for 0.75%

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}
