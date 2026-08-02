import { centsToMoney, moneyToCents, sumMoney } from './report-money.utils';

describe('report money utilities', () => {
  it('normalizes Float values to cents before aggregation', () => {
    expect(moneyToCents(0.1 + 0.2)).toBe(30);
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(centsToMoney(123_456)).toBe(1234.56);
  });
});
