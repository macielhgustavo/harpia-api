import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProposalPaymentConditionType } from '@prisma/client';
import { CreateProposalDto } from './create-proposal.dto';
import { ListProposalsQueryDto } from './list-proposals-query.dto';
import { RejectProposalDto } from './reject-proposal.dto';

describe('Proposal DTOs', () => {
  it('accepts a normalized proposal with nested payment conditions', async () => {
    const dto = plainToInstance(CreateProposalDto, {
      personId: 'person-1',
      unitId: 'unit-1',
      discount: '1000.00',
      notes: '  Condição especial  ',
      conditions: [
        {
          type: ProposalPaymentConditionType.PARCELAS,
          amount: '9000.00',
          installments: '12',
          intervalMonths: '1',
        },
      ],
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.notes).toBe('Condição especial');
    expect(dto.conditions[0].installments).toBe(12);
  });

  it('rejects negative money, empty conditions and overlong notes', async () => {
    const dto = plainToInstance(CreateProposalDto, {
      personId: 'person-1',
      unitId: 'unit-1',
      discount: '-1.00',
      notes: 'x'.repeat(4001),
      conditions: [],
    });
    const properties = (await validate(dto)).map((error) => error.property);
    expect(properties).toEqual(
      expect.arrayContaining(['discount', 'notes', 'conditions']),
    );
  });

  it('validates bounded pagination and trims a required rejection reason', async () => {
    const query = plainToInstance(ListProposalsQueryDto, {
      page: '2',
      pageSize: '101',
    });
    expect((await validate(query)).map((error) => error.property)).toContain(
      'pageSize',
    );

    const rejection = plainToInstance(RejectProposalDto, {
      reason: '  Cliente recusou  ',
    });
    expect(await validate(rejection)).toHaveLength(0);
    expect(rejection.reason).toBe('Cliente recusou');
  });
});
