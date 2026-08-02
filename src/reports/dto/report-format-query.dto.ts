import { IsEnum } from 'class-validator';

export enum ReportFormat {
  XLSX = 'xlsx',
  PDF = 'pdf',
}

export class ReportFormatQueryDto {
  @IsEnum(ReportFormat, {
    message: 'format deve ser um dos valores: xlsx, pdf',
  })
  format: ReportFormat;
}
