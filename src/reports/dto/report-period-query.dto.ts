import { IsDateString, IsOptional, IsString, Matches } from 'class-validator';
import { ReportFormatQueryDto } from './report-format-query.dto';

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ReportPeriodQueryDto extends ReportFormatQueryDto {
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN, {
    message: 'startDate deve estar no formato YYYY-MM-DD',
  })
  @IsDateString({}, { message: 'startDate deve ser uma data v\u00e1lida' })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN, {
    message: 'endDate deve estar no formato YYYY-MM-DD',
  })
  @IsDateString({}, { message: 'endDate deve ser uma data v\u00e1lida' })
  endDate?: string;
}
