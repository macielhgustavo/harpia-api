import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  ReportColumn,
  ReportColumnKind,
  ReportData,
  ReportSummaryItem,
  ReportValue,
} from '../types/report.types';

const PAGE_MARGIN = 36;
const CELL_PADDING = 4;
const TABLE_FONT_SIZE = 7;
const TABLE_LINE_HEIGHT = 9;
const MAX_CELL_LINES = 4;
const MAX_CELL_TEXT_LENGTH = 500;

interface TableLayout {
  columnWidths: number[];
  rowHeight: number;
  startX: number;
  availableWidth: number;
}

@Injectable()
export class PdfReportExporter {
  export(report: ReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: 'A4',
        layout: report.columns.length > 6 ? 'landscape' : 'portrait',
        margin: PAGE_MARGIN,
        bufferPages: true,
        info: {
          Title: report.title,
          Author: 'Harpia',
          Creator: 'Harpia',
        },
      });
      const chunks: Buffer[] = [];

      document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      try {
        this.render(document, report);
        document.end();
      } catch (error) {
        document.destroy(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  private render(document: PDFKit.PDFDocument, report: ReportData): void {
    const layout = this.createLayout(document, report.columns);
    let y = this.drawPageIntroduction(document, report, true);

    if (!report.columns.length) {
      document
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#595959')
        .text('Nenhuma coluna disponível para este relatório.', PAGE_MARGIN, y);
      this.addPageNumbers(document);
      return;
    }

    y = this.ensureHeaderSpace(document, report, layout, y);
    y = this.drawTableHeader(document, report.columns, layout, y);

    if (!report.rows.length) {
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#595959')
        .text(
          'Nenhum registro encontrado para os filtros informados.',
          layout.startX,
          y + 8,
        );
      y += 30;
    } else {
      for (const row of report.rows) {
        const rowHeight = this.calculateRowHeight(
          document,
          report.columns,
          row,
          layout,
        );
        if (y + rowHeight > this.bottomBoundary(document)) {
          document.addPage();
          y = this.drawPageIntroduction(document, report, false);
          y = this.drawTableHeader(document, report.columns, layout, y);
        }
        this.drawDataRow(document, report.columns, row, layout, y, rowHeight);
        y += rowHeight;
      }
    }

    this.drawSummary(document, report.summary, y, layout, report);
    this.addPageNumbers(document);
  }

  private createLayout(
    document: PDFKit.PDFDocument,
    columns: readonly ReportColumn[],
  ): TableLayout {
    const availableWidth = document.page.width - PAGE_MARGIN * 2;
    const defaultWeight = columns.length ? 1 / columns.length : 1;
    const weights = columns.map((column) => {
      if (column.width) {
        return Math.max(column.width, 1);
      }

      return column.kind === 'text' ? 1.5 : 1;
    });
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const columnWidths = columns.map((_column, index) =>
      Math.max(
        42,
        availableWidth * ((weights[index] ?? defaultWeight) / weightSum),
      ),
    );
    const scale =
      availableWidth / columnWidths.reduce((sum, width) => sum + width, 0);

    return {
      columnWidths: columnWidths.map((width) => width * scale),
      rowHeight: TABLE_LINE_HEIGHT + CELL_PADDING * 2,
      startX: PAGE_MARGIN,
      availableWidth,
    };
  }

  private drawPageIntroduction(
    document: PDFKit.PDFDocument,
    report: ReportData,
    includeFilters: boolean,
  ): number {
    let y = PAGE_MARGIN;
    document
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#17365D')
      .text('Harpia', PAGE_MARGIN, y, { lineBreak: false });
    y += 21;
    document
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#1F1F1F')
      .text(safePdfText(report.title), PAGE_MARGIN, y, {
        width: document.page.width - PAGE_MARGIN * 2,
      });
    y = document.y + 5;

    document
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#595959')
      .text(
        `Gerado em: ${formatGeneratedAt(report.generatedAt)}`,
        PAGE_MARGIN,
        y,
      );
    y = document.y + 4;

    if (includeFilters) {
      const filterText = report.filters.length
        ? report.filters
            .map(
              (filter) =>
                `${safePdfText(filter.label)}: ${formatReportValue(filter.value, 'text')}`,
            )
            .join('  |  ')
        : 'Sem filtros aplicados';
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#595959')
        .text(`Filtros: ${filterText}`, PAGE_MARGIN, y, {
          width: document.page.width - PAGE_MARGIN * 2,
        });
      y = document.y + 8;
    } else {
      y += 4;
    }

    return y;
  }

  private ensureHeaderSpace(
    document: PDFKit.PDFDocument,
    report: ReportData,
    layout: TableLayout,
    y: number,
  ): number {
    if (y + layout.rowHeight <= this.bottomBoundary(document)) {
      return y;
    }

    document.addPage();
    return this.drawPageIntroduction(document, report, false);
  }

  private drawTableHeader(
    document: PDFKit.PDFDocument,
    columns: readonly ReportColumn[],
    layout: TableLayout,
    y: number,
  ): number {
    let x = layout.startX;
    document.font('Helvetica-Bold').fontSize(TABLE_FONT_SIZE);
    for (const [index, column] of columns.entries()) {
      const width = layout.columnWidths[index];
      document
        .rect(x, y, width, layout.rowHeight)
        .fillAndStroke('#17365D', '#FFFFFF');
      document
        .fillColor('#FFFFFF')
        .text(safePdfText(column.label), x + CELL_PADDING, y + CELL_PADDING, {
          width: width - CELL_PADDING * 2,
          height: layout.rowHeight - CELL_PADDING * 2,
          ellipsis: true,
        });
      x += width;
    }

    return y + layout.rowHeight;
  }

  private calculateRowHeight(
    document: PDFKit.PDFDocument,
    columns: readonly ReportColumn[],
    row: ReportData['rows'][number],
    layout: TableLayout,
  ): number {
    document.font('Helvetica').fontSize(TABLE_FONT_SIZE);
    const tallestCell = columns.reduce((tallest, column, index) => {
      const text = formatReportValue(row[column.key], column.kind);
      const cellHeight = document.heightOfString(text, {
        width: layout.columnWidths[index] - CELL_PADDING * 2,
        lineGap: 1,
      });
      return Math.max(
        tallest,
        Math.min(cellHeight, TABLE_LINE_HEIGHT * MAX_CELL_LINES),
      );
    }, TABLE_LINE_HEIGHT);

    return Math.max(layout.rowHeight, tallestCell + CELL_PADDING * 2);
  }

  private drawDataRow(
    document: PDFKit.PDFDocument,
    columns: readonly ReportColumn[],
    row: ReportData['rows'][number],
    layout: TableLayout,
    y: number,
    rowHeight: number,
  ): void {
    let x = layout.startX;
    document.font('Helvetica').fontSize(TABLE_FONT_SIZE);

    for (const [index, column] of columns.entries()) {
      const width = layout.columnWidths[index];
      document.rect(x, y, width, rowHeight).strokeColor('#D9E1F2').stroke();
      document
        .fillColor('#1F1F1F')
        .text(
          formatReportValue(row[column.key], column.kind),
          x + CELL_PADDING,
          y + CELL_PADDING,
          {
            width: width - CELL_PADDING * 2,
            height: rowHeight - CELL_PADDING * 2,
            ellipsis: true,
            lineGap: 1,
          },
        );
      x += width;
    }
  }

  private drawSummary(
    document: PDFKit.PDFDocument,
    summary: readonly ReportSummaryItem[],
    initialY: number,
    layout: TableLayout,
    report: ReportData,
  ): void {
    if (!summary.length) {
      return;
    }

    let y = initialY + 12;
    const ensureSpace = (needed: number): void => {
      if (y + needed <= this.bottomBoundary(document)) {
        return;
      }
      document.addPage();
      y = this.drawPageIntroduction(document, report, false);
    };

    ensureSpace(24);
    document
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#17365D')
      .text('Resumo / Totais', layout.startX, y);
    y = document.y + 4;

    for (const item of summary) {
      ensureSpace(18);
      const text = `${safePdfText(item.label)}: ${formatReportValue(
        item.value,
        item.kind ?? 'text',
      )}`;
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#1F1F1F')
        .text(text, layout.startX, y, { width: layout.availableWidth });
      y = document.y + 2;
    }
  }

  private bottomBoundary(document: PDFKit.PDFDocument): number {
    return document.page.height - PAGE_MARGIN - 24;
  }

  private addPageNumbers(document: PDFKit.PDFDocument): void {
    const pages = document.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      document.switchToPage(pages.start + index);
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#595959')
        .text(
          `Página ${index + 1} de ${pages.count}`,
          PAGE_MARGIN,
          document.page.height - PAGE_MARGIN - 12,
          {
            width: document.page.width - PAGE_MARGIN * 2,
            align: 'right',
            lineBreak: false,
          },
        );
    }
  }
}

export function formatReportValue(
  value: ReportValue,
  kind: ReportColumnKind,
): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (typeof value === 'number') {
    if (kind === 'currency') {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(value);
    }
    if (kind === 'number') {
      return new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits: 2,
      }).format(value);
    }
  }

  if (kind === 'date') {
    const date = parseDate(value);
    if (date) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'UTC',
      }).format(date);
    }
  }

  return safePdfText(String(value));
}

function formatGeneratedAt(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

function parseDate(value: ReportValue): Date | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const parsed = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function safePdfText(value: string): string {
  const normalized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    const isControlCharacter =
      code === 127 || (code >= 0 && code <= 8) || (code >= 11 && code <= 31);
    if (
      code === 0x2013 ||
      code === 0x2014 ||
      code === 0x2212 ||
      code === 0x00b7
    ) {
      return '-';
    }
    if (code === 0x2026) {
      return '...';
    }
    return isControlCharacter ? ' ' : character;
  }).join('');
  return normalized.length > MAX_CELL_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_CELL_TEXT_LENGTH - 3)}...`
    : normalized;
}
