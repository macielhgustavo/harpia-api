import { Matches } from 'class-validator';

export class CreateReceivableAdjustmentDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  startCompetence: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  endCompetence: string;
}
