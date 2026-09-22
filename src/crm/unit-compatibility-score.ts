import { Prisma } from '@prisma/client';
import type { MatchCriterion, MatchInterest, MatchRow } from './unit-matching';

export const COMPATIBILITY_WEIGHTS = Object.freeze({
  PRICE: 50,
  AREA: 25,
  BEDROOMS: 25,
});

// 100 - multiplier * (distance / violated boundary): zero at 10%/20%.
export const COMPATIBILITY_DEVIATION_MULTIPLIERS = Object.freeze({
  PRICE: 1000,
  AREA: 500,
});

if (
  Object.values(COMPATIBILITY_WEIGHTS).reduce(
    (sum, weight) => sum + weight,
    0,
  ) !== 100
) {
  throw new Error('Pesos de compatibilidade devem somar 100');
}

export type ScoreCriterion = keyof typeof COMPATIBILITY_WEIGHTS;
export type CompatibilityLevel =
  'EXCELENTE' | 'ALTA' | 'MODERADA' | 'BAIXA' | 'NOT_EVALUATED';

type DecimalInput = Prisma.Decimal | number;

function decimal(value: DecimalInput): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function clampScore(value: Prisma.Decimal): number {
  return Math.max(
    0,
    Math.min(
      100,
      value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    ),
  );
}

function rangeScore(
  value: DecimalInput | null,
  minimum: DecimalInput | null,
  maximum: DecimalInput | null,
  deviationMultiplier: number,
): number | null {
  if (value == null || (minimum == null && maximum == null)) return null;
  const actual = decimal(value);
  const boundary =
    minimum != null && actual.lessThan(minimum)
      ? decimal(minimum)
      : maximum != null && actual.greaterThan(maximum)
        ? decimal(maximum)
        : null;
  if (!boundary) return 100;
  if (boundary.isZero()) return 0;
  return clampScore(
    new Prisma.Decimal(100).minus(
      actual.minus(boundary).abs().div(boundary).mul(deviationMultiplier),
    ),
  );
}

export function scorePrice(
  price: Prisma.Decimal | null,
  minimum: Prisma.Decimal | null,
  maximum: Prisma.Decimal | null,
): number | null {
  return rangeScore(
    price,
    minimum,
    maximum,
    COMPATIBILITY_DEVIATION_MULTIPLIERS.PRICE,
  );
}

export function scoreArea(
  area: Prisma.Decimal | null,
  minimum: number | null,
  maximum: number | null,
): number | null {
  return rangeScore(
    area,
    minimum,
    maximum,
    COMPATIBILITY_DEVIATION_MULTIPLIERS.AREA,
  );
}

export function scoreBedrooms(
  bedrooms: number | null,
  minimum: number | null,
  maximum: number | null,
): number | null {
  if (bedrooms == null || (minimum == null && maximum == null)) return null;
  const distance =
    minimum != null && bedrooms < minimum
      ? minimum - bedrooms
      : maximum != null && bedrooms > maximum
        ? bedrooms - maximum
        : 0;
  return Math.max(0, 100 - distance * 50);
}

export function compatibilityLevel(score: number | null): CompatibilityLevel {
  if (score == null) return 'NOT_EVALUATED';
  if (score >= 90) return 'EXCELENTE';
  if (score >= 75) return 'ALTA';
  if (score >= 50) return 'MODERADA';
  return 'BAIXA';
}

export function scoreUnitCompatibility(
  interest: MatchInterest,
  candidate: Pick<MatchRow, 'price' | 'area' | 'bedrooms'>,
  criteria: MatchCriterion[],
) {
  const scores: Record<ScoreCriterion, number | null> = {
    PRICE: scorePrice(candidate.price, interest.minPrice, interest.maxPrice),
    AREA: scoreArea(candidate.area, interest.minArea, interest.maxArea),
    BEDROOMS: scoreBedrooms(
      candidate.bedrooms,
      interest.minBedrooms,
      interest.maxBedrooms,
    ),
  };
  const evaluatedWeight = (Object.keys(scores) as ScoreCriterion[]).reduce(
    (sum, code) =>
      sum + (scores[code] == null ? 0 : COMPATIBILITY_WEIGHTS[code]),
    0,
  );
  const weightedPoints = (Object.keys(scores) as ScoreCriterion[]).reduce(
    (sum, code) => sum + (scores[code] ?? 0) * COMPATIBILITY_WEIGHTS[code],
    0,
  );
  const compatibilityScore =
    evaluatedWeight === 0 ? null : Math.round(weightedPoints / evaluatedWeight);
  const scoreFactors = (Object.keys(scores) as ScoreCriterion[]).map((code) => {
    const criterion = criteria.find((item) => item.code === code);
    const criterionScore = scores[code];
    return {
      criterion: code,
      weight: COMPATIBILITY_WEIGHTS[code],
      criterionScore,
      contribution:
        criterionScore == null
          ? null
          : new Prisma.Decimal(criterionScore)
              .mul(COMPATIBILITY_WEIGHTS[code])
              .div(100)
              .toFixed(2),
      maximumContribution:
        criterionScore == null ? null : COMPATIBILITY_WEIGHTS[code],
      status:
        criterionScore == null
          ? 'NOT_EVALUATED'
          : (criterion?.status ?? 'NOT_EVALUATED'),
      explanation: criterion?.message ?? 'Preferência não informada',
    };
  });
  return {
    compatibilityScore,
    compatibilityLevel: compatibilityLevel(compatibilityScore),
    evaluatedWeight,
    scoreFactors,
  };
}
