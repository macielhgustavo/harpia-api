import { Workbook } from 'exceljs';
import { ReportData } from '../types/report.types';
import {
  ExcelReportExporter,
  sanitizeExcelText,
} from './excel-report.exporter';

const report: ReportData = {
  title: 'Captações por período',
  sheetName: 'Captações',
  filters: [{ label: 'Período', value: '2026-01-01 a 2026-01-31' }],
  columns: [
    { key: 'investor', label: 'Investidor', kind: 'text' },
    { key: 'amount', label: 'Valor', kind: 'currency' },
    { key: 'date', label: 'Data', kind: 'date' },
  ],
  rows: [
    {
      investor: '  =HYPERLINK("https://example.com")',
      amount: 1234.56,
      date: '2026-01-15',
    },
  ],
  summary: [{ label: 'Total captado', value: 1234.56, kind: 'currency' }],
  generatedAt: new Date('2026-02-01T10:30:00.000Z'),
};

describe('ExcelReportExporter', () => {
  it('creates a non-empty workbook with numeric BRL values and a frozen header', async () => {
    const buffer = await new ExcelReportExporter().export(report);
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Captações');

    expect(buffer.length).toBeGreaterThan(0);
    expect(worksheet).toBeDefined();
    expect(worksheet!.getCell('B6').value).toBe(1234.56);
    expect(worksheet!.getCell('B6').numFmt).toContain('R$');
    expect(worksheet!.autoFilter).toBe('A5:C6');
    expect(worksheet!.views[0]?.state).toBe('frozen');
    expect(worksheet!.views[0]?.ySplit).toBe(5);
  });

  it('makes leading spreadsheet formulas safe even when they start after whitespace', async () => {
    expect(sanitizeExcelText(' =SUM(A1:A2)')).toBe("' =SUM(A1:A2)");
    expect(sanitizeExcelText('+1')).toBe("'+1");
    expect(sanitizeExcelText('-1')).toBe("'-1");
    expect(sanitizeExcelText('@name')).toBe("'@name");

    const buffer = await new ExcelReportExporter().export(report);
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Captações');

    expect(worksheet!.getCell('A6').value).toBe(
      '\'  =HYPERLINK("https://example.com")',
    );
  });
});
