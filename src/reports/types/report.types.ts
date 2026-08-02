export type ReportColumnKind = 'text' | 'date' | 'currency' | 'number';

export type ReportValue = string | number | null | undefined;

/** A flat, renderer-agnostic record produced by the reports service. */
export type ReportRow = Record<string, ReportValue>;

export interface ReportColumn {
  /** Key used to read the value from a ReportRow. */
  key: string;
  /** Human-readable column heading. */
  label: string;
  kind: ReportColumnKind;
  /** Optional preferred width in Excel character units / PDF relative weight. */
  width?: number;
}

export interface ReportFilter {
  label: string;
  value: ReportValue;
}

export interface ReportSummaryItem {
  label: string;
  value: ReportValue;
  /** Defaults to text when omitted. */
  kind?: ReportColumnKind;
}

/**
 * Normalized report data shared by every exporter. Values are deliberately
 * primitive so the service can consolidate Prisma results before rendering.
 */
export interface ReportData {
  title: string;
  /** Optional worksheet title. Invalid Excel characters are removed by the exporter. */
  sheetName?: string;
  filters: readonly ReportFilter[];
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  summary: readonly ReportSummaryItem[];
  generatedAt: Date;
}
