import { Prisma } from '@prisma/client';
import { MatchInterest, MatchRow, presentUnitMatch } from './unit-matching';

const interest: MatchInterest = {
  developmentId: 'dev-1',
  unitTypeId: 'type-1',
  minBedrooms: 2,
  maxBedrooms: 3,
  minArea: 70,
  maxArea: 90,
  minPrice: new Prisma.Decimal('300000.00'),
  maxPrice: new Prisma.Decimal('500000.00'),
  availableDownPayment: new Prisma.Decimal('80000.00'),
  purpose: 'MORADIA',
};
const row: MatchRow = {
  total: 1n,
  id: 'unit-1',
  identifier: '305',
  developmentId: 'dev-1',
  developmentName: 'Aurora',
  unitTypeId: 'type-1',
  unitTypeName: 'Dois quartos',
  bedrooms: 2,
  area: new Prisma.Decimal('78.00'),
  price: new Prisma.Decimal('489000.00'),
  priceTableId: 'table-1',
  priceTableName: 'Vigente',
  bedroomsMatch: true,
  areaMatch: true,
  priceMatch: true,
  matchedSoft: 3,
  mismatchedSoft: 0,
  priceDeviation: new Prisma.Decimal('0.00'),
  compatibilityScore: 100,
};

describe('presentUnitMatch', () => {
  it('returns structured, explainable hard and soft criteria', () => {
    const result = presentUnitMatch(row, interest, null);
    expect(result.unit).toMatchObject({ id: 'unit-1', isSelected: false });
    expect(result.compatibility).toEqual({
      matched: 6,
      evaluated: 6,
      mismatched: 0,
      notEvaluated: 2,
    });
    expect(
      result.criteria.map((item) => [item.code, item.kind, item.status]),
    ).toEqual([
      ['AVAILABILITY', 'HARD', 'MATCH'],
      ['DEVELOPMENT', 'HARD', 'MATCH'],
      ['UNIT_TYPE', 'HARD', 'MATCH'],
      ['BEDROOMS', 'SOFT', 'MATCH'],
      ['AREA', 'SOFT', 'MATCH'],
      ['PRICE', 'SOFT', 'MATCH'],
      ['DOWN_PAYMENT', 'INFORMATIONAL', 'NOT_EVALUATED'],
      ['PURPOSE', 'INFORMATIONAL', 'NOT_EVALUATED'],
    ]);
    expect(result.price.value).toBe('489000.00');
  });

  it('identifies selected unit without modifying ranking', () => {
    const selected = presentUnitMatch(row, interest, 'unit-1');
    const unselected = presentUnitMatch(row, interest, null);
    expect(selected.unit.isSelected).toBe(true);
    expect(selected.ranking).toEqual(unselected.ranking);
  });

  it.each([
    ['above maximum', '515000.00', '15000.00', 'acima do máximo'],
    ['below minimum', '290000.00', '10000.00', 'abaixo do mínimo'],
  ])(
    'explains price %s with exact decimal difference',
    (_label, price, deviation, phrase) => {
      const result = presentUnitMatch(
        {
          ...row,
          price: new Prisma.Decimal(price),
          priceMatch: false,
          matchedSoft: 2,
          mismatchedSoft: 1,
          priceDeviation: new Prisma.Decimal(deviation),
          compatibilityScore: price === '515000.00' ? 85 : 84,
        },
        interest,
        null,
      );
      expect(
        result.criteria.find((item) => item.code === 'PRICE'),
      ).toMatchObject({
        status: 'MISMATCH',
        difference: deviation,
      });
      expect(
        result.criteria.find((item) => item.code === 'PRICE')?.message,
      ).toContain(phrase);
    },
  );

  it('marks missing attributes not evaluated instead of inventing a match', () => {
    const result = presentUnitMatch(
      {
        ...row,
        bedrooms: null,
        area: null,
        bedroomsMatch: null,
        areaMatch: null,
        matchedSoft: 1,
      },
      interest,
      null,
    );
    expect(
      result.criteria.find((item) => item.code === 'BEDROOMS')?.status,
    ).toBe('NOT_EVALUATED');
    expect(result.criteria.find((item) => item.code === 'AREA')?.status).toBe(
      'NOT_EVALUATED',
    );
    expect(result.compatibility).toMatchObject({ matched: 4, notEvaluated: 4 });
  });

  it('does not add unspecified criteria for a partial profile', () => {
    const partial: MatchInterest = {
      developmentId: null,
      unitTypeId: null,
      minBedrooms: null,
      maxBedrooms: null,
      minArea: null,
      maxArea: null,
      minPrice: null,
      maxPrice: null,
      availableDownPayment: null,
      purpose: null,
    };
    const result = presentUnitMatch(
      {
        ...row,
        bedroomsMatch: null,
        areaMatch: null,
        priceMatch: null,
        matchedSoft: 0,
        compatibilityScore: null,
      },
      partial,
      null,
    );
    expect(result.criteria.map((item) => item.code)).toEqual(['AVAILABILITY']);
    expect(result.ranking.priceWithinRange).toBeNull();
  });
});
