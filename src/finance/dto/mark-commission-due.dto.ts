import { IsDateString, IsOptional } from 'class-validator';

export class MarkCommissionDueDto {
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
