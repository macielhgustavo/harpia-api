import { Prisma } from '@prisma/client';
import { MatchInterest, MatchRow, MatchCriterion } from './unit-matching';
import {
  COMPATIBILITY_WEIGHTS,
  compatibilityLevel,
  scoreArea,
  scoreBedrooms,
  scorePrice,
  scoreUnitCompatibility,
} from './unit-compatibility-score';

const d = (value: string) => new Prisma.Decimal(value);
const interest: MatchInterest = {
  developmentId: null,
  unitTypeId: null,
  minBedrooms: 2,
  maxBedrooms: 3,
  minArea: 70,
  maxArea: 90,
  minPrice: null,
  maxPrice: d('500000.00'),
  availableDownPayment: d('100000.00'),
  purpose: 'MORADIA',
};
const candidate: Pick<MatchRow, 'price' | 'area' | 'bedrooms'> = {
  price: d('490000.00'),
  area: d('80.00'),
  bedrooms: 2,
};
const criteria: MatchCriterion[] = [
  {
    code: 'PRICE',
    kind: 'SOFT',
    status: 'MATCH',
    message: 'Dentro do orçamento',
    actual: '490000.00',
  },
  {
    code: 'AREA',
    kind: 'SOFT',
    status: 'MATCH',
    message: 'Dentro da faixa',
    actual: '80.00',
  },
  {
    code: 'BEDROOMS',
    kind: 'SOFT',
    status: 'MATCH',
    message: 'Dentro da faixa',
    actual: 2,
  },
  {
    code: 'DOWN_PAYMENT',
    kind: 'INFORMATIONAL',
    status: 'NOT_EVALUATED',
    message: 'Não avaliado',
    actual: null,
  },
  {
    code: 'PURPOSE',
    kind: 'INFORMATIONAL',
    status: 'NOT_EVALUATED',
    message: 'Não avaliado',
    actual: null,
  },
];

describe('unit compatibility score', () => {
  it('keeps fixed weights at 100 and returns a fully explained perfect score', () => {
    expect(COMPATIBILITY_WEIGHTS).toEqual({
      PRICE: 50,
      AREA: 25,
      BEDROOMS: 25,
    });
    expect(
      Object.values(COMPATIBILITY_WEIGHTS).reduce((a, b) => a + b, 0),
    ).toBe(100);
    const result = scoreUnitCompatibility(interest, candidate, criteria);
    expect(result).toMatchObject({
      compatibilityScore: 100,
      compatibilityLevel: 'EXCELENTE',
      evaluatedWeight: 100,
    });
    expect(result.scoreFactors).toEqual([
      expect.objectContaining({
        criterion: 'PRICE',
        criterionScore: 100,
        contribution: '50.00',
        explanation: 'Dentro do orçamento',
      }),
      expect.objectContaining({
        criterion: 'AREA',
        criterionScore: 100,
        contribution: '25.00',
      }),
      expect.objectContaining({
        criterion: 'BEDROOMS',
        criterionScore: 100,
        contribution: '25.00',
      }),
    ]);
  });

  it.each([
    ['inside', '490000.00', 100],
    ['slightly above', '505000.00', 90],
    ['far above', '750000.00', 0],
    ['rounding half up', '502500.00', 95],
    ['zero boundary', '1.00', 0],
    ['extreme decimal', '100000000000000000001.00', 0],
  ])('scores price %s', (_name, value, expected) => {
    const limit = value === '1.00' ? d('0.00') : interest.maxPrice;
    expect(scorePrice(d(value), null, limit)).toBe(expected);
  });

  it.each([
    ['inside', '80.00', 100],
    ['one square metre high', '91.00', 94],
    ['far above', '120.00', 0],
    ['slightly below', '69.00', 93],
    ['zero boundary', '1.00', 0],
  ])('scores area %s', (_name, value, expected) => {
    expect(
      scoreArea(
        d(value),
        value === '1.00' ? null : 70,
        value === '1.00' ? 0 : 90,
      ),
    ).toBe(expected);
  });

  it.each([
    ['inside', 2, 100],
    ['one below', 1, 50],
    ['two above', 5, 0],
  ])('scores bedrooms %s', (_name, value, expected) => {
    expect(scoreBedrooms(value, 2, 3)).toBe(expected);
  });

  it('excludes missing and informational criteria from the denominator', () => {
    const result = scoreUnitCompatibility(
      {
        ...interest,
        minArea: null,
        maxArea: null,
        minBedrooms: null,
        maxBedrooms: null,
      },
      { ...candidate, price: d('505000.00') },
      criteria,
    );
    expect(result).toMatchObject({
      compatibilityScore: 90,
      compatibilityLevel: 'EXCELENTE',
      evaluatedWeight: 50,
    });
    expect(result.scoreFactors.slice(1)).toEqual([
      expect.objectContaining({
        criterionScore: null,
        contribution: null,
        status: 'NOT_EVALUATED',
      }),
      expect.objectContaining({
        criterionScore: null,
        contribution: null,
        status: 'NOT_EVALUATED',
      }),
    ]);
  });

  it('never invents 100 when no soft criterion is evaluable', () => {
    const result = scoreUnitCompatibility(
      {
        ...interest,
        minPrice: null,
        maxPrice: null,
        minArea: null,
        maxArea: null,
        minBedrooms: null,
        maxBedrooms: null,
      },
      candidate,
      [],
    );
    expect(result).toMatchObject({
      compatibilityScore: null,
      compatibilityLevel: 'NOT_EVALUATED',
      evaluatedWeight: 0,
    });
    expect(
      result.scoreFactors.every(
        (factor) => factor.criterionScore == null && factor.explanation,
      ),
    ).toBe(true);
  });

  it('handles missing candidate attributes and partial weighted score deterministically', () => {
    expect(scoreArea(null, 70, 90)).toBeNull();
    expect(scoreBedrooms(null, 2, 3)).toBeNull();
    expect(scorePrice(d('100.00'), null, null)).toBeNull();
    const one = scoreUnitCompatibility(
      interest,
      { price: d('505000.00'), area: d('91.00'), bedrooms: 1 },
      criteria,
    );
    const two = scoreUnitCompatibility(
      interest,
      { price: d('505000.00'), area: d('91.00'), bedrooms: 1 },
      criteria,
    );
    expect(one).toEqual(two);
    expect(one).toMatchObject({
      compatibilityScore: 81,
      compatibilityLevel: 'ALTA',
    });
    expect(one.scoreFactors.map((factor) => factor.criterionScore)).toEqual([
      90, 94, 50,
    ]);
  });

  it.each([
    [0, 'BAIXA'],
    [49, 'BAIXA'],
    [50, 'MODERADA'],
    [74, 'MODERADA'],
    [75, 'ALTA'],
    [89, 'ALTA'],
    [90, 'EXCELENTE'],
    [100, 'EXCELENTE'],
    [null, 'NOT_EVALUATED'],
  ])('classifies %s as %s', (score, expected) => {
    expect(compatibilityLevel(score)).toBe(expected);
  });
});
