import { BadRequestException } from '@nestjs/common';
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  timelineKeysQuery,
} from './opportunity-timeline-pagination';

describe('opportunity timeline cursor and key query', () => {
  const key = {
    id: 'stage:history-1',
    occurredAt: new Date('2026-09-05T10:00:00.000Z'),
  };

  it('round-trips an opportunity-bound cursor', () => {
    const encoded = encodeTimelineCursor('opportunity-1', key);
    expect(decodeTimelineCursor(encoded, 'opportunity-1')).toEqual(key);
    expect(() => decodeTimelineCursor(encoded, 'opportunity-2')).toThrow(
      BadRequestException,
    );
  });

  it('rejects malformed and oversized cursors', () => {
    expect(() => decodeTimelineCursor('not-a-json', 'opportunity-1')).toThrow(
      BadRequestException,
    );
    expect(() =>
      decodeTimelineCursor('a'.repeat(513), 'opportunity-1'),
    ).toThrow(BadRequestException);
  });

  it('selects all six sources before a single global limit and stable ordering', () => {
    const sql = timelineKeysQuery('org-a', 'opportunity-1', key, 21);
    const text = sql.strings.join('?');
    for (const table of [
      'OpportunityStageHistory',
      'SalesActivity',
      'SalesVisit',
      'UnitReservation',
      'SalesProposal',
      'Sale',
    ]) {
      expect(text).toContain(`FROM "${table}"`);
    }
    expect(text).toContain('ORDER BY events."occurredAt" DESC, events.id ASC');
    expect(text).toContain('events."occurredAt" <');
    expect(text).toContain('events.id >');
    expect(text).toContain('LIMIT');
    expect(sql.values).toContain('org-a');
    expect(sql.values).toContain('opportunity-1');
    expect(sql.values).toContain(key.occurredAt);
    expect(sql.values).toContain(key.id);
    expect(sql.values).toContain(21);
  });
});
