export function moneyToCents(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToMoney(cents: number): number {
  return cents / 100;
}

export function sumMoney(values: Iterable<number | null | undefined>): number {
  let cents = 0;
  for (const value of values) {
    cents += moneyToCents(value);
  }
  return centsToMoney(cents);
}

export function addMoney(...values: Array<number | null | undefined>): number {
  return sumMoney(values);
}
