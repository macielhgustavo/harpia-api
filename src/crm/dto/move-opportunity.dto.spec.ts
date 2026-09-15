import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_LOST_REASON_LENGTH } from '../opportunity-stage';
import { MoveOpportunityDto } from './move-opportunity.dto';

const parse = (payload: Record<string, unknown>) =>
  plainToInstance(MoveOpportunityDto, payload);

describe('MoveOpportunityDto loss reason', () => {
  it('trims the reason before validation and before it reaches the writer', () => {
    const dto = parse({
      stageId: 'stage-lost',
      lostReason: '  Preço acima do orçamento  ',
    });

    expect(dto.lostReason).toBe('Preço acima do orçamento');
  });

  it('accepts a reason at the shared limit', async () => {
    const dto = parse({
      stageId: 'stage-lost',
      lostReason: 'x'.repeat(MAX_LOST_REASON_LENGTH),
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a payload longer than the shared limit', async () => {
    const dto = parse({
      stageId: 'stage-lost',
      lostReason: 'x'.repeat(MAX_LOST_REASON_LENGTH + 1),
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(['lostReason']);
  });

  it('measures the limit after trimming, not before', async () => {
    const dto = parse({
      stageId: 'stage-lost',
      lostReason: `   ${'x'.repeat(MAX_LOST_REASON_LENGTH)}   `,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('keeps the reason optional for a move that is not a loss', async () => {
    await expect(
      validate(parse({ stageId: 'stage-qualified' })),
    ).resolves.toHaveLength(0);
  });
});
