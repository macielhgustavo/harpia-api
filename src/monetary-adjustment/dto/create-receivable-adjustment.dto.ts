import { IsDateString, IsObject } from 'class-validator';

export class CreateReceivableAdjustmentDto {
  @IsDateString()
  startCompetence: string;

  @IsDateString()
  endCompetence: string;

  @IsObject()
  indexValues: Record<string, number>;
}
