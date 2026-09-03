import { IsString } from 'class-validator';

export class MatchReconciliationDto {
  @IsString()
  transactionId!: string;
}
