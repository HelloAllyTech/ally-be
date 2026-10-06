import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  EffectivenessFunnelQueryDto,
  FoundationalSkillsSegmentsQueryDto,
} from '../effectiveness-analytics.dto';

/**
 * The query DTOs arrive as strings off the URL. `dimension` is a closed
 * vocabulary (it picks which lookup runs); `cuts`/`baselineFrom` coerce like
 * GET foundational-skills/progress; `tenantId` takes a uuid or a code and
 * nothing that could carry SQL.
 */
describe('Effectiveness query DTOs', () => {
  const segments = async (payload: Record<string, unknown>) => {
    const dto = plainToInstance(FoundationalSkillsSegmentsQueryDto, payload);
    return { dto, errors: await validate(dto) };
  };

  it('accepts every dimension and no dimension at all', async () => {
    for (const dimension of [
      undefined,
      'language',
      'workerType',
      'orgSize',
      'course',
      'difficulty',
      'difficultyTransition',
    ]) {
      expect((await segments({ dimension })).errors).toHaveLength(0);
    }
  });

  it('rejects a dimension outside the enum', async () => {
    const { errors } = await segments({ dimension: 'role' });
    expect(errors.map((e) => e.property)).toEqual(['dimension']);
  });

  it('coerces cuts and baselineFrom from the query string', async () => {
    const { dto, errors } = await segments({ cuts: '4', baselineFrom: '2' });
    expect(errors).toHaveLength(0);
    expect(dto.cuts).toBe(4);
    expect(dto.baselineFrom).toBe(2);
    expect((await segments({ baselineFrom: '3' })).errors).toHaveLength(1);
    expect((await segments({ cuts: '1' })).errors).toHaveLength(1);
  });

  it('takes a tenant uuid or code, nothing else', async () => {
    for (const tenantId of ['b3f1c2d4-0000-4000-8000-000000000001', 'ally']) {
      expect((await segments({ tenantId })).errors).toHaveLength(0);
      expect(
        await validate(
          plainToInstance(EffectivenessFunnelQueryDto, { tenantId }),
        ),
      ).toHaveLength(0);
    }
    expect((await segments({ tenantId: "x' OR 1=1" })).errors).toHaveLength(1);
    expect(
      await validate(
        plainToInstance(EffectivenessFunnelQueryDto, { tenantId: 'a b' }),
      ),
    ).toHaveLength(1);
  });
});
