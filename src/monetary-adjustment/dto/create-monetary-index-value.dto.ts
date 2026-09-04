import { IsDateString, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateMonetaryIndexValueDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  competence: string;

  @IsNumber()
  @Min(-0.9999)
  @Max(9.9999)
  percentage: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}
