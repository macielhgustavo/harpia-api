import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MonetaryAdjustmentService {
  constructor(private prisma: PrismaService) {}

  // MonetaryIndex
  async findAllMonetaryIndices() {
    return this.prisma.monetaryIndex.findMany();
  }

  async createMonetaryIndex(data: any) {
    return this.prisma.monetaryIndex.create({ data });
  }

  async updateMonetaryIndex(id: string, data: any) {
    return this.prisma.monetaryIndex.update({ where: { id }, data });
  }

  // MonetaryIndexValue
  async findMonetaryIndexValues(monetaryIndexId: string) {
    return this.prisma.monetaryIndexValue.findMany({
      where: { monetaryIndexId },
    });
  }

  async createMonetaryIndexValue(data: any) {
    return this.prisma.monetaryIndexValue.create({ data });
  }

  async updateMonetaryIndexValue(id: string, data: any) {
    return this.prisma.monetaryIndexValue.update({ where: { id }, data });
  }

  // ReceivableAdjustmentPolicy
  async createReceivableAdjustmentPolicy(data: any) {
    return this.prisma.receivableAdjustmentPolicy.create({ data });
  }

  // ReceivableAdjustment
  async previewReceivableAdjustment(
    receivableId: string,
    dto: { startCompetence: string; endCompetence: string; indexValues: Record<string, number> },
  ) {
    const receivable = await this.prisma.receivable.findUnique({
      where: { id: receivableId },
      include: { adjustmentPolicies: true },
    });

    if (!receivable) {
      throw new NotFoundException(`Receivable with id ${receivableId} not found`);
    }

    if (!receivable.adjustmentPolicies || receivable.adjustmentPolicies.length === 0) {
      throw new NotFoundException(`No adjustment policy found for receivable ${receivableId}`);
    }

    // We assume there is at most one policy per receivable (due to unique constraint)
    const policy = receivable.adjustmentPolicies[0];

    // Get the monetary index values for the competence range
    const indexValues = await this.prisma.monetaryIndexValue.findMany({
      where: {
        monetaryIndexId: policy.monetaryIndexId,
        competence: {
          gte: dto.startCompetence,
          lte: dto.endCompetence,
        },
      },
      select: { competence: true, percentage: true },
      orderBy: { competence: 'asc' },
    });

    if (indexValues.length === 0) {
      // No index values in the range, so no adjustment
      return {
        previousAmount: receivable.adjustedAmount,
        adjustedAmount: receivable.adjustedAmount,
        difference: 0,
        startCompetence: dto.startCompetence,
        endCompetence: dto.endCompetence,
        indexValues: {},
      };
    }

    // Compute the compound factor
    let factor = 1;
    const indexValueMap: Record<string, number> = {};
    for const iv of indexValues) {
      indexValueMap[iv.competence] = iv.percentage;
      factor *= 1 + iv.percentage;
    }

    const previousAmount = receivable.adjustedAmount;
    const adjustedAmount = previousAmount * factor;
    const difference = adjustedAmount - previousAmount;

    return {
      previousAmount,
      adjustedAmount,
      difference,
      startCompetence: dto.startCompetence,
      endCompetence: dto.endCompetence,
      indexValues: indexValueMap,
    };
  }

  async createReceivableAdjustment(
    receivableId: string,
    dto: { startCompetence: string; endCompetence: string; indexValues: Record<string, number> },
    userId: string,
  ) {
    const receivable = await this.prisma.receivable.findUnique({
      where: { id: receivableId },
      include: { adjustmentPolicies: true },
    });

    if (!receivable) {
      throw new NotFoundException(`Receivable with id ${receivableId} not found`);
    }

    if (!receivable.adjustmentPolicies || receivable.adjustmentPolicies.length === 0) {
      throw new NotFoundException(`No adjustment policy found for receivable ${receivableId}`);
    }

    const policy = receivable.adjustmentPolicies[0];

    // Get the monetary index values for the competence range
    const indexValues = await this.prisma.monetaryIndexValue.findMany({
      where: {
        monetaryIndexId: policy.monetaryIndexId,
        competence: {
          gte: dto.startCompetence,
          lte: dto.endCompetence,
        },
      },
      select: { competence: true, percentage: true },
      orderBy: { competence: 'asc' },
    });

    if (indexValues.length === 0) {
      // No index values in the range, so no adjustment
      // We still create an adjustment record with zero difference?
      // But the specification says application should update the adjustedAmount.
      // If there is no adjustment, we might not create a record? Or we create a record with zero difference.
      // We'll create a record with zero difference and not change the adjustedAmount.
      const adjustment = await this.prisma.receivableAdjustment.create({
        data: {
          receivableId,
          previousAmount: receivable.adjustedAmount,
          adjustedAmount: receivable.adjustedAmount,
          difference: 0,
          startCompetence: dto.startCompetence,
          endCompetence: dto.endCompetence,
          indexValues: {},
          appliedById: userId,
          appliedAt: new Date(),
        },
      });

      return adjustment;
    }

    // Compute the compound factor
    let factor = 1;
    const indexValueMap: Record<string, number> = {};
    for (const iv of indexValues) {
      indexValueMap[iv.competence] = iv.percentage;
      factor *= 1 + iv.percentage;
    }

    const previousAmount = receivable.adjustedAmount;
    const adjustedAmount = previousAmount * factor;
    const difference = adjustedAmount - previousAmount;

    // Update the receivable's adjustedAmount
    await this.prisma.receivable.update({
      where: { id: receivableId },
      data: { adjustedAmount },
    });

    // Create the adjustment record
    const adjustment = await this.prisma.receivableAdjustment.create({
      data: {
        receivableId,
        previousAmount,
        adjustedAmount,
        difference,
        startCompetence: dto.startCompetence,
        endCompetence: dto.endCompetence,
        indexValues: indexValueMap,
        appliedById: userId,
        appliedAt: new Date(),
      },
    });

    return adjustment;
  }

  async getReceivableAdjustments(receivableId: string) {
    return this.prisma.receivableAdjustment.findMany({
      where: { receivableId },
      orderBy: { appliedAt: 'desc' },
    });
  }
}
