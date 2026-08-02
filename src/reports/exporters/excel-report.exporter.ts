import { Injectable } from '@nestjs/common';
import { Workbook, Worksheet } from 'exceljs';
import {
  ReportColumn,
  ReportColumnKind,
  ReportData,
  ReportValue,
} from '../types/report.types';

const BRL_NUMBER_FORMAT = '"R$" #,##0.00';
const NUMBER_FORMAT = '#,##0.00';
const DATE_FORMAT = 'dd/mm/yyyy';
const MAX_COLUMN_WIDTH = 48;
const MIN_COLUMN_WIDTH = 12;

/**
 * Prevents spreadsheet applications from evaluating untrusted textual data as
 * a formula. Leading whitespace is significant because Excel ignores it when
 * determining whether a cell starts with a formula.
 */
export function sanitizeExcelText(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function safeWorksheetName(value: string): string {
  const normalized = value
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);

  return normalized || 'Relatório';
}

@Injectable()
export class ExcelReportExporter {
  async export(report: ReportData): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Harpia';
    workbook.created = report.generatedAt;
    workbook.modified = report.generatedAt;

    const worksheet = workbook.addWorksheet(
      safeWorksheetName(report.sheetName ?? report.title),
      {
        views: [{ showGridLines: false }],
      },
    );
    const totalColumns = Math.max(report.columns.length, 1);

    this.addReportMetadata(worksheet, report, totalColumns);
    worksheet.addRow([]);
    const headerRowNumber = worksheet.lastRow!.number + 1;
    this.addTableHeader(worksheet, report.columns);
    this.addRows(worksheet, report.columns, report.rows);
    const lastDataRow = headerRowNumber + report.rows.length;
    this.addSummary(worksheet, report, totalColumns);
    this.configureTable(
      worksheet,
      headerRowNumber,
      lastDataRow,
      report.columns.length,
    );
    this.configureColumnWidths(worksheet, report.columns, report.rows);

    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
  }

  private addReportMetadata(
    worksheet: Worksheet,
    report: ReportData,
    totalColumns: number,
  ): void {
    const titleRow = worksheet.addRow([sanitizeExcelText(report.title)]);
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, totalColumns);
    titleRow.getCell(1).font = {
      bold: true,
      size: 16,
      color: { argb: '17365D' },
    };
    titleRow.getCell(1).alignment = { vertical: 'middle' };
    titleRow.height = 26;

    const filterText = report.filters.length
      ? report.filters
          .map(
            (filter) =>
              `${sanitizeExcelText(filter.label)}: ${formatPlainValue(filter.value)}`,
          )
          .join(' | ')
      : 'Sem filtros aplicados';
    const filtersRow = worksheet.addRow([`Filtros: ${filterText}`]);
    worksheet.mergeCells(filtersRow.number, 1, filtersRow.number, totalColumns);
    filtersRow.getCell(1).font = { italic: true, color: { argb: '595959' } };
    filtersRow.getCell(1).alignment = { wrapText: true, vertical: 'top' };

    const generatedAtRow = worksheet.addRow([
      `Gerado em: ${formatGeneratedAt(report.generatedAt)}`,
    ]);
    worksheet.mergeCells(
      generatedAtRow.number,
      1,
      generatedAtRow.number,
      totalColumns,
    );
    generatedAtRow.getCell(1).font = { size: 10, color: { argb: '595959' } };
  }

  private addTableHeader(
    worksheet: Worksheet,
    columns: readonly ReportColumn[],
  ): void {
    const headerRow = worksheet.addRow(
      columns.map((column) => sanitizeExcelText(column.label)),
    );
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '17365D' },
    };
    headerRow.alignment = { vertical: 'middle', wrapText: true };
    headerRow.height = 22;
  }

  private addRows(
    worksheet: Worksheet,
    columns: readonly ReportColumn[],
    rows: ReportData['rows'],
  ): void {
    for (const sourceRow of rows) {
      const row = worksheet.addRow(
        columns.map((column) =>
          toExcelValue(sourceRow[column.key], column.kind),
        ),
      );

      columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        applyCellFormat(cell, column.kind);
      });

      row.alignment = { vertical: 'top', wrapText: true };
    }
  }

  private addSummary(
    worksheet: Worksheet,
    report: ReportData,
    totalColumns: number,
  ): void {
    if (!report.summary.length) {
      return;
    }

    worksheet.addRow([]);
    const heading = worksheet.addRow(['Resumo / Totais']);
    worksheet.mergeCells(heading.number, 1, heading.number, totalColumns);
    heading.getCell(1).font = { bold: true, color: { argb: '17365D' } };

    for (const item of report.summary) {
      const row = worksheet.addRow([
        sanitizeExcelText(item.label),
        toExcelValue(item.value, item.kind ?? 'text'),
      ]);
      row.getCell(1).font = { bold: true };
      applyCellFormat(row.getCell(2), item.kind ?? 'text');
      row.getCell(2).font = { bold: true };
    }
  }

  private configureTable(
    worksheet: Worksheet,
    headerRowNumber: number,
    lastDataRow: number,
    columnCount: number,
  ): void {
    if (!columnCount) {
      return;
    }

    worksheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: Math.max(headerRowNumber, lastDataRow), column: columnCount },
    };
    worksheet.views = [
      {
        state: 'frozen',
        ySplit: headerRowNumber,
        showGridLines: false,
      },
    ];
  }

  private configureColumnWidths(
    worksheet: Worksheet,
    columns: readonly ReportColumn[],
    rows: ReportData['rows'],
  ): void {
    columns.forEach((column, index) => {
      const excelColumn = worksheet.getColumn(index + 1);
      const contentWidth = rows.reduce<number>(
        (widest, row) =>
          Math.max(widest, formatPlainValue(row[column.key]).length),
        column.label.length,
      );
      excelColumn.width = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, column.width ?? contentWidth + 2),
      );
    });
  }
}

function toExcelValue(
  value: ReportValue,
  kind: ReportColumnKind,
): ReportValue | Date {
  if (value === null || value === undefined || typeof value === 'number') {
    return value;
  }

  if (kind === 'date') {
    return toDate(value) ?? sanitizeExcelText(value);
  }

  return sanitizeExcelText(value);
}

function applyCellFormat(
  cell: ReturnType<Worksheet['getCell']>,
  kind: ReportColumnKind,
): void {
  if (kind === 'currency') {
    cell.numFmt = BRL_NUMBER_FORMAT;
    cell.alignment = { horizontal: 'right', vertical: 'top' };
  } else if (kind === 'number') {
    cell.numFmt = NUMBER_FORMAT;
    cell.alignment = { horizontal: 'right', vertical: 'top' };
  } else if (kind === 'date' && cell.value instanceof Date) {
    cell.numFmt = DATE_FORMAT;
    cell.alignment = { horizontal: 'left', vertical: 'top' };
  }
}

function toDate(value: string): Date | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return isValidDate(parsed) &&
      parsed.getFullYear() === Number(year) &&
      parsed.getMonth() === Number(month) - 1 &&
      parsed.getDate() === Number(day)
      ? parsed
      : undefined;
  }

  const parsed = new Date(value);
  return isValidDate(parsed) ? parsed : undefined;
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function formatGeneratedAt(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

function formatPlainValue(value: ReportValue): string {
  if (value === null || value === undefined) {
    return '—';
  }

  return typeof value === 'string' ? sanitizeExcelText(value) : String(value);
}
