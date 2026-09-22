import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnitMatchesQueryDto } from './dto/unit-matches-query.dto';
import { MatchRow, presentUnitMatch } from './unit-matching';
import {
  COMPATIBILITY_DEVIATION_MULTIPLIERS,
  COMPATIBILITY_WEIGHTS,
} from './unit-compatibility-score';

@Injectable()
export class UnitMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  async findMatches(
    opportunityId: string,
    organizationId: string,
    query: UnitMatchesQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, organizationId },
      select: { id: true, unitId: true },
    });
    if (!opportunity)
      throw new NotFoundException('Oportunidade não encontrada');

    const interest = await this.prisma.opportunityPropertyInterest.findFirst({
      where: { opportunityId, organizationId },
      select: {
        developmentId: true,
        unitTypeId: true,
        minBedrooms: true,
        maxBedrooms: true,
        minArea: true,
        maxArea: true,
        minPrice: true,
        maxPrice: true,
        availableDownPayment: true,
        purpose: true,
      },
    });
    if (!interest) {
      return {
        data: [],
        reason: 'PROFILE_REQUIRED' as const,
        pagination: { page, pageSize, total: 0, totalPages: 0 },
      };
    }

    const developmentFilter = interest.developmentId
      ? Prisma.sql`AND u."developmentId" = ${interest.developmentId}`
      : Prisma.empty;
    const unitTypeFilter = interest.unitTypeId
      ? Prisma.sql`AND u."unitTypeId" = ${interest.unitTypeId} AND ut."id" IS NOT NULL`
      : Prisma.empty;
    // Count and page use the same candidate set and snapshot. The lateral price
    // lookup follows the exact ordering used by proposals.findActivePrice.
    const rows = await this.prisma.$queryRaw<MatchRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT u."id", u."identifier", u."developmentId",
          d."name" AS "developmentName", ut."id" AS "unitTypeId",
          ut."name" AS "unitTypeName", ut."bedrooms",
          ROUND((CASE WHEN u."category" = 'LOTE' THEN u."landArea"
            ELSE COALESCE(u."builtArea", ut."standardArea") END)::numeric, 2) AS "area",
          ROUND(latest."value"::numeric, 2) AS "price",
          latest."priceTableId", latest."priceTableName"
        FROM "Unit" u
        JOIN "Development" d ON d."id" = u."developmentId"
          AND d."organizationId" = ${organizationId}
        LEFT JOIN "UnitType" ut ON ut."id" = u."unitTypeId"
          AND ut."organizationId" = ${organizationId}
          AND ut."developmentId" = u."developmentId"
        JOIN LATERAL (
          SELECT up."value", pt."id" AS "priceTableId",
            pt."name" AS "priceTableName"
          FROM "UnitPrice" up
          JOIN "PriceTable" pt ON pt."id" = up."priceTableId"
            AND pt."organizationId" = ${organizationId}
            AND pt."developmentId" = u."developmentId"
            AND pt."active" = true
          WHERE up."unitId" = u."id" AND up."organizationId" = ${organizationId}
          ORDER BY up."updatedAt" DESC, up."id" DESC
          LIMIT 1
        ) latest ON true
        WHERE u."organizationId" = ${organizationId}
          AND u."status" = 'DISPONIVEL'
          AND d."status" <> 'CANCELADO'
          ${developmentFilter} ${unitTypeFilter}
          AND NOT EXISTS (
            SELECT 1 FROM "UnitReservation" r
            WHERE r."organizationId" = ${organizationId}
              AND r."unitId" = u."id" AND r."status" = 'ATIVA'
          )
          AND NOT EXISTS (
            SELECT 1 FROM "Sale" s
            WHERE s."organizationId" = ${organizationId}
              AND s."unitId" = u."id" AND s."status" IN ('ATIVA', 'QUITADA')
          )
      ), evaluated AS (
        SELECT c.*,
          CASE WHEN ${interest.minBedrooms}::integer IS NULL
            AND ${interest.maxBedrooms}::integer IS NULL THEN NULL
            WHEN c."bedrooms" IS NULL THEN NULL
            ELSE (${interest.minBedrooms}::integer IS NULL OR c."bedrooms" >= ${interest.minBedrooms}::integer)
              AND (${interest.maxBedrooms}::integer IS NULL OR c."bedrooms" <= ${interest.maxBedrooms}::integer)
          END AS "bedroomsMatch",
          CASE WHEN ${interest.minArea}::numeric IS NULL
            AND ${interest.maxArea}::numeric IS NULL THEN NULL
            WHEN c."area" IS NULL THEN NULL
            ELSE (${interest.minArea}::numeric IS NULL OR c."area" >= ${interest.minArea}::numeric)
              AND (${interest.maxArea}::numeric IS NULL OR c."area" <= ${interest.maxArea}::numeric)
          END AS "areaMatch",
          CASE WHEN ${interest.minPrice}::numeric IS NULL
            AND ${interest.maxPrice}::numeric IS NULL THEN NULL
            ELSE (${interest.minPrice}::numeric IS NULL OR c."price" >= ${interest.minPrice}::numeric)
              AND (${interest.maxPrice}::numeric IS NULL OR c."price" <= ${interest.maxPrice}::numeric)
          END AS "priceMatch"
        FROM candidates c
      ), ranked AS (
        SELECT e.*,
          (CASE WHEN e."bedroomsMatch" IS TRUE THEN 1 ELSE 0 END
            + CASE WHEN e."areaMatch" IS TRUE THEN 1 ELSE 0 END
            + CASE WHEN e."priceMatch" IS TRUE THEN 1 ELSE 0 END) AS "matchedSoft",
          (CASE WHEN e."bedroomsMatch" IS FALSE THEN 1 ELSE 0 END
            + CASE WHEN e."areaMatch" IS FALSE THEN 1 ELSE 0 END
            + CASE WHEN e."priceMatch" IS FALSE THEN 1 ELSE 0 END) AS "mismatchedSoft",
          CASE WHEN ${interest.minPrice}::numeric IS NOT NULL
              AND e."price" < ${interest.minPrice}::numeric
              THEN ${interest.minPrice}::numeric - e."price"
            WHEN ${interest.maxPrice}::numeric IS NOT NULL
              AND e."price" > ${interest.maxPrice}::numeric
              THEN e."price" - ${interest.maxPrice}::numeric
            ELSE 0::numeric END AS "priceDeviation"
        FROM evaluated e
      ), scored AS (
        SELECT r.*,
          CASE WHEN r."priceMatch" IS NULL THEN NULL
            WHEN r."priceMatch" THEN 100
            ELSE COALESCE(GREATEST(0, ROUND(100 - r."priceDeviation" * ${COMPATIBILITY_DEVIATION_MULTIPLIERS.PRICE} /
              NULLIF(CASE WHEN ${interest.minPrice}::numeric IS NOT NULL
                AND r."price" < ${interest.minPrice}::numeric
                THEN ${interest.minPrice}::numeric
                ELSE ${interest.maxPrice}::numeric END, 0), 0))::integer, 0)
          END AS "priceCriterionScore",
          CASE WHEN r."areaMatch" IS NULL THEN NULL
            WHEN r."areaMatch" THEN 100
            ELSE COALESCE(GREATEST(0, ROUND(100 - ABS(r."area" -
              CASE WHEN ${interest.minArea}::numeric IS NOT NULL
                AND r."area" < ${interest.minArea}::numeric
                THEN ${interest.minArea}::numeric
                ELSE ${interest.maxArea}::numeric END) * ${COMPATIBILITY_DEVIATION_MULTIPLIERS.AREA} /
              NULLIF(CASE WHEN ${interest.minArea}::numeric IS NOT NULL
                AND r."area" < ${interest.minArea}::numeric
                THEN ${interest.minArea}::numeric
                ELSE ${interest.maxArea}::numeric END, 0), 0))::integer, 0)
          END AS "areaCriterionScore",
          CASE WHEN r."bedroomsMatch" IS NULL THEN NULL
            WHEN r."bedroomsMatch" THEN 100
            ELSE GREATEST(0, 100 - 50 *
              CASE WHEN ${interest.minBedrooms}::integer IS NOT NULL
                AND r."bedrooms" < ${interest.minBedrooms}::integer
                THEN ${interest.minBedrooms}::integer - r."bedrooms"
                ELSE r."bedrooms" - ${interest.maxBedrooms}::integer END)
          END AS "bedroomsCriterionScore"
        FROM ranked r
      ), weighted AS (
        SELECT s.*,
          CASE WHEN
            (CASE WHEN s."priceCriterionScore" IS NULL THEN 0 ELSE ${COMPATIBILITY_WEIGHTS.PRICE} END
            + CASE WHEN s."areaCriterionScore" IS NULL THEN 0 ELSE ${COMPATIBILITY_WEIGHTS.AREA} END
            + CASE WHEN s."bedroomsCriterionScore" IS NULL THEN 0 ELSE ${COMPATIBILITY_WEIGHTS.BEDROOMS} END) = 0
            THEN NULL
            ELSE ROUND((
              COALESCE(s."priceCriterionScore", 0) * ${COMPATIBILITY_WEIGHTS.PRICE}
              + COALESCE(s."areaCriterionScore", 0) * ${COMPATIBILITY_WEIGHTS.AREA}
              + COALESCE(s."bedroomsCriterionScore", 0) * ${COMPATIBILITY_WEIGHTS.BEDROOMS}
            )::numeric / (
              CASE WHEN s."priceCriterionScore" IS NULL THEN 0 ELSE ${COMPATIBILITY_WEIGHTS.PRICE} END
              + CASE WHEN s."areaCriterionScore" IS NULL THEN 0 ELSE ${COMPATIBILITY_WEIGHTS.AREA} END
              + CASE WHEN s."bedroomsCriterionScore" IS NULL THEN 0 ELSE ${COMPATIBILITY_WEIGHTS.BEDROOMS} END
            ), 0)::integer
          END AS "compatibilityScore"
        FROM scored s
      )
      SELECT totals."total", page.*
      FROM (SELECT COUNT(*) AS "total" FROM weighted) totals
      LEFT JOIN LATERAL (
        SELECT * FROM weighted
        ORDER BY "compatibilityScore" DESC NULLS LAST,
          ("priceMatch" IS FALSE) ASC,
          "matchedSoft" DESC, "mismatchedSoft" ASC,
          "priceDeviation" ASC, "identifier" COLLATE "C" ASC,
          "developmentId" ASC, "id" ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      ) page ON true
    `);
    const total = Number(rows[0]?.total ?? 0);
    return {
      data: rows
        .filter((row) => row.id)
        .map((row) => presentUnitMatch(row, interest, opportunity.unitId)),
      reason: null,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}
