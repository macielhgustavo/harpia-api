import { Prisma, PropertyInterestPurpose } from '@prisma/client';
import { scoreUnitCompatibility } from './unit-compatibility-score';

export interface MatchInterest {
  developmentId: string | null;
  unitTypeId: string | null;
  minBedrooms: number | null;
  maxBedrooms: number | null;
  minArea: number | null;
  maxArea: number | null;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  availableDownPayment: Prisma.Decimal | null;
  purpose: PropertyInterestPurpose | null;
}

export interface MatchRow {
  total: bigint;
  id: string | null;
  identifier: string | null;
  developmentId: string | null;
  developmentName: string | null;
  unitTypeId: string | null;
  unitTypeName: string | null;
  bedrooms: number | null;
  area: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
  priceTableId: string | null;
  priceTableName: string | null;
  bedroomsMatch: boolean | null;
  areaMatch: boolean | null;
  priceMatch: boolean | null;
  matchedSoft: number | null;
  mismatchedSoft: number | null;
  priceDeviation: Prisma.Decimal | null;
  compatibilityScore: number | null;
}

export type CriterionStatus = 'MATCH' | 'MISMATCH' | 'NOT_EVALUATED';
export type CriterionKind = 'HARD' | 'SOFT' | 'INFORMATIONAL';

export interface MatchCriterion {
  code:
    | 'AVAILABILITY'
    | 'DEVELOPMENT'
    | 'UNIT_TYPE'
    | 'BEDROOMS'
    | 'AREA'
    | 'PRICE'
    | 'DOWN_PAYMENT'
    | 'PURPOSE';
  kind: CriterionKind;
  status: CriterionStatus;
  message: string;
  actual: string | number | null;
  minimum?: string | number | null;
  maximum?: string | number | null;
  difference?: string;
}

function money(value: Prisma.Decimal): string {
  const [whole, cents] = value.toFixed(2).split('.');
  return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`;
}

function area(value: Prisma.Decimal): string {
  return value.toString().replace('.', ',');
}

function rangeStatus(match: boolean | null): CriterionStatus {
  return match == null ? 'NOT_EVALUATED' : match ? 'MATCH' : 'MISMATCH';
}

export function presentUnitMatch(
  row: MatchRow,
  interest: MatchInterest,
  selectedUnitId: string | null,
) {
  if (
    !row.id ||
    !row.identifier ||
    !row.developmentId ||
    !row.developmentName ||
    !row.price ||
    !row.priceTableId ||
    !row.priceTableName
  ) {
    throw new Error('Linha de matching incompleta');
  }
  const criteria: MatchCriterion[] = [
    {
      code: 'AVAILABILITY',
      kind: 'HARD',
      status: 'MATCH',
      message: 'Unidade disponível, sem reserva ativa nem venda vigente',
      actual: 'DISPONIVEL',
    },
  ];
  if (interest.developmentId) {
    criteria.push({
      code: 'DEVELOPMENT',
      kind: 'HARD',
      status: 'MATCH',
      message: `Empreendimento desejado: ${row.developmentName}`,
      actual: row.developmentId,
    });
  }
  if (interest.unitTypeId) {
    criteria.push({
      code: 'UNIT_TYPE',
      kind: 'HARD',
      status: 'MATCH',
      message: `Tipologia desejada: ${row.unitTypeName ?? 'não informada'}`,
      actual: row.unitTypeId,
    });
  }
  if (interest.minBedrooms != null || interest.maxBedrooms != null) {
    const status = rangeStatus(row.bedroomsMatch);
    criteria.push({
      code: 'BEDROOMS',
      kind: 'SOFT',
      status,
      message:
        row.bedrooms == null
          ? 'Quantidade de quartos não informada no catálogo'
          : status === 'MATCH'
            ? `${row.bedrooms} quarto(s) dentro da faixa desejada`
            : `${row.bedrooms} quarto(s) fora da faixa desejada`,
      actual: row.bedrooms,
      minimum: interest.minBedrooms,
      maximum: interest.maxBedrooms,
    });
  }
  if (interest.minArea != null || interest.maxArea != null) {
    const status = rangeStatus(row.areaMatch);
    criteria.push({
      code: 'AREA',
      kind: 'SOFT',
      status,
      message:
        row.area == null
          ? 'Área não informada no catálogo'
          : `${area(row.area)} m² ${status === 'MATCH' ? 'dentro' : 'fora'} da faixa desejada`,
      actual: row.area?.toString() ?? null,
      minimum: interest.minArea,
      maximum: interest.maxArea,
    });
  }
  if (interest.minPrice || interest.maxPrice) {
    const status = rangeStatus(row.priceMatch);
    const difference = row.priceDeviation?.toFixed(2) ?? '0.00';
    const direction =
      interest.maxPrice && row.price.greaterThan(interest.maxPrice)
        ? `acima do máximo em ${money(new Prisma.Decimal(difference))}`
        : interest.minPrice && row.price.lessThan(interest.minPrice)
          ? `abaixo do mínimo em ${money(new Prisma.Decimal(difference))}`
          : 'dentro da faixa desejada';
    criteria.push({
      code: 'PRICE',
      kind: 'SOFT',
      status,
      message: `${money(row.price)}: ${direction}`,
      actual: row.price.toFixed(2),
      minimum: interest.minPrice?.toFixed(2) ?? null,
      maximum: interest.maxPrice?.toFixed(2) ?? null,
      difference,
    });
  }
  if (interest.availableDownPayment) {
    criteria.push({
      code: 'DOWN_PAYMENT',
      kind: 'INFORMATIONAL',
      status: 'NOT_EVALUATED',
      message: `Entrada disponível de ${money(interest.availableDownPayment)}; não há entrada mínima definida para esta unidade`,
      actual: interest.availableDownPayment.toFixed(2),
    });
  }
  if (interest.purpose) {
    criteria.push({
      code: 'PURPOSE',
      kind: 'INFORMATIONAL',
      status: 'NOT_EVALUATED',
      message:
        'Objetivo informado; o estoque não possui atributo objetivo para compará-lo',
      actual: interest.purpose,
    });
  }
  const matched = criteria.filter((item) => item.status === 'MATCH').length;
  const mismatched = criteria.filter(
    (item) => item.status === 'MISMATCH',
  ).length;
  const notEvaluated = criteria.filter(
    (item) => item.status === 'NOT_EVALUATED',
  ).length;
  const scoring = scoreUnitCompatibility(interest, row, criteria);
  if (row.compatibilityScore !== scoring.compatibilityScore) {
    throw new Error('Score de compatibilidade divergente da ordenação');
  }
  return {
    unit: {
      id: row.id,
      identifier: row.identifier,
      status: 'DISPONIVEL',
      isSelected: row.id === selectedUnitId,
    },
    development: { id: row.developmentId, name: row.developmentName },
    unitType: row.unitTypeId
      ? { id: row.unitTypeId, name: row.unitTypeName }
      : null,
    features: { bedrooms: row.bedrooms, area: row.area?.toString() ?? null },
    price: {
      value: row.price.toFixed(2),
      priceTable: { id: row.priceTableId, name: row.priceTableName },
    },
    compatibility: {
      matched,
      evaluated: matched + mismatched,
      mismatched,
      notEvaluated,
    },
    ...scoring,
    ranking: {
      priceWithinRange: row.priceMatch,
      matchedSoft: row.matchedSoft ?? 0,
      mismatchedSoft: row.mismatchedSoft ?? 0,
      priceDeviation: row.priceDeviation?.toFixed(2) ?? '0.00',
    },
    criteria,
  };
}
