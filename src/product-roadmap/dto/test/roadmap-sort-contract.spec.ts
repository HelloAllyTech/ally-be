import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListOpportunitiesQueryDto } from '../roadmap-opportunity.dto';

/**
 * The DTO's sortBy whitelist and the repository's SORT_COLUMNS are two lists that must agree,
 * and nothing in the type system makes them.
 *
 * THIS TEST EXISTS BECAUSE THE DRIFT ALREADY HAPPENED. When the composite rank landed, the
 * repository gained `composite` and the board began defaulting to it — but this DTO still
 * rejected the value, so every board load 400'd while a curl with no `sortBy` (server default
 * applied after validation) looked perfectly healthy. The failure is invisible to any test that
 * does not send the parameter over the wire.
 */
const SORTS = [
  'composite',
  'priority',
  'voters',
  'createdAt',
  'releasedAt',
  'myVotes',
  'description',
  'plannedMonth',
] as const;

describe('ListOpportunitiesQueryDto.sortBy', () => {
  it.each(SORTS)('accepts %s', async (sortBy) => {
    const dto = plainToInstance(ListOpportunitiesQueryDto, { sortBy });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'sortBy')).toHaveLength(0);
  });

  it('rejects a value the repository has no column for', async () => {
    const dto = plainToInstance(ListOpportunitiesQueryDto, {
      sortBy: 'notAColumn',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sortBy')).toBe(true);
  });

  it('accepts an omitted sortBy, so the server default applies', async () => {
    const dto = plainToInstance(ListOpportunitiesQueryDto, {});
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'sortBy')).toHaveLength(0);
  });
});
