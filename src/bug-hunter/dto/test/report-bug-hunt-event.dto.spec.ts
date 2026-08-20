import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportBugHuntEventDto } from '../bug-hunter.dto';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';

/**
 * The point of this DTO is that a stage the enum doesn't know is refused at
 * the edge. Before it existed the value went straight into the INSERT, hit
 * `CHK_bug_hunt_events_stage`, and came back to the pipeline as a generic
 * 500 `Database query failed` — which is how the sweep prompt's
 * `verify_result` went a week dropping every Phase-2 verification event
 * without anyone noticing.
 */
describe('ReportBugHuntEventDto', () => {
  const validateDto = (payload: Record<string, unknown>) =>
    validate(plainToInstance(ReportBugHuntEventDto, payload));

  const minimal = {
    stage: BugHuntEventStage.VERIFY,
    summary: 'two of three refutations landed',
  };

  it('accepts the minimal body the prompts actually send', async () => {
    expect(await validateDto(minimal)).toHaveLength(0);
  });

  it('accepts every stage the enum defines', async () => {
    for (const stage of Object.values(BugHuntEventStage)) {
      expect(await validateDto({ ...minimal, stage })).toHaveLength(0);
    }
  });

  it('accepts a full body', async () => {
    const errors = await validateDto({
      ...minimal,
      repo: 'ally-be',
      payload: { refutations: 2 },
      findingId: '11111111-1111-4111-8111-111111111111',
      suggestionId: '22222222-2222-4222-8222-222222222222',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects the exact drift that caused this: verify_result', async () => {
    const errors = await validateDto({ ...minimal, stage: 'verify_result' });
    expect(errors.some((e) => e.property === 'stage')).toBe(true);
  });

  it.each([['finder_results'], ['VERIFY'], [''], ['anything at all']])(
    'rejects the unknown stage %p',
    async (stage) => {
      const errors = await validateDto({ ...minimal, stage });
      expect(errors.some((e) => e.property === 'stage')).toBe(true);
    },
  );

  it('requires a stage and a summary', async () => {
    expect(
      (await validateDto({ summary: 'x' })).some((e) => e.property === 'stage'),
    ).toBe(true);
    expect(
      (await validateDto({ stage: BugHuntEventStage.ERROR })).some(
        (e) => e.property === 'summary',
      ),
    ).toBe(true);
  });

  it('rejects a non-uuid finding id rather than letting the FK do it', async () => {
    const errors = await validateDto({ ...minimal, findingId: 'not-a-uuid' });
    expect(errors.some((e) => e.property === 'findingId')).toBe(true);
  });
});
