import { ReportData } from '../types/report.types';
import { formatReportValue, PdfReportExporter } from './pdf-report.exporter';

const report: ReportData = {
  title: 'Retornos previstos e realizados',
  filters: [{ label: 'Status', value: 'ATRASADO' }],
  columns: [
    { key: 'investor', label: 'Investidor', kind: 'text' },
    { key: 'amount', label: 'Valor previsto', kind: 'currency' },
    { key: 'expectedDate', label: 'Vencimento', kind: 'date' },
  ],
  rows: Array.from({ length: 60 }, (_value, index) => ({
    investor: `Investidor com observação muito longa ${index + 1}: ${'x'.repeat(180)}`,
    amount: 1000 + index,
    expectedDate: '2026-01-15',
  })),
  summary: [{ label: 'Total atrasado', value: 61770, kind: 'currency' }],
  generatedAt: new Date('2026-02-01T10:30:00.000Z'),
};

describe('PdfReportExporter', () => {
  it('creates an in-memory PDF with a valid signature for long, paginated data', async () => {
    const buffer = await new PdfReportExporter().export(report);

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('formats monetary and date values in pt-BR', () => {
    expect(formatReportValue(1234.5, 'currency')).toBe('R$ 1.234,50');
    expect(formatReportValue('2026-01-15', 'date')).toBe('15/01/2026');
  });
});
