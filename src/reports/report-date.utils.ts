import { BadRequestException } from '@nestjs/common';
import { ISO_DATE_PATTERN } from './dto/report-period-query.dto';

export const MAX_REPORT_PERIOD_DAYS = 366;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface ReportPeriod {
  start?: Date;
  endExclusive?: Date;
}

export function parseIsoCalendarDate(value: string, fieldName: string): Date {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new BadRequestException(
      `${fieldName} deve estar no formato YYYY-MM-DD`,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${fieldName} deve ser uma data v\u00e1lida`);
  }

  return date;
}

export function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function getInclusiveReportPeriod(
  startDate?: string,
  endDate?: string,
): ReportPeriod {
  const start = startDate
    ? parseIsoCalendarDate(startDate, 'startDate')
    : undefined;
  const end = endDate ? parseIsoCalendarDate(endDate, 'endDate') : undefined;

  if ((start && !end) || (!start && end)) {
    throw new BadRequestException(
      'startDate e endDate devem ser informados juntos',
    );
  }

  if (start && end) {
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException(
        'startDate n\u00e3o pode ser posterior a endDate',
      );
    }

    const periodDays =
      Math.floor((end.getTime() - start.getTime()) / DAY_IN_MILLISECONDS) + 1;
    if (periodDays > MAX_REPORT_PERIOD_DAYS) {
      throw new BadRequestException(
        `O per\u00edodo m\u00e1ximo para relat\u00f3rios \u00e9 de ${MAX_REPORT_PERIOD_DAYS} dias`,
      );
    }
  }

  return {
    start,
    endExclusive: end ? addUtcDays(end, 1) : undefined,
  };
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcCalendarDaysBetween(from: Date, until: Date): number {
  const fromDay = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const untilDay = Date.UTC(
    until.getUTCFullYear(),
    until.getUTCMonth(),
    until.getUTCDate(),
  );
  return Math.floor((untilDay - fromDay) / DAY_IN_MILLISECONDS);
}
