import { Module } from '@nestjs/common';
import { ExcelReportExporter } from './exporters/excel-report.exporter';
import { PdfReportExporter } from './exporters/pdf-report.exporter';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ExcelReportExporter, PdfReportExporter],
})
export class ReportsModule {}
