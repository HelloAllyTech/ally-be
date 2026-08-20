import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { DriftJudgeRepository } from '../drift-judge.repository';

/**
 * The transcript carries which client turns the learner talked over, so the
 * judge can stop charging a cut-off sentence to actor quality.
 *
 * Measured on the first week the `interrupted` flag was written at all
 * (2026-08-17): truncation ran 4.42% on uninterrupted turns against 15.63% on
 * interrupted ones, and just over half of all truncation annotations sat on
 * interrupted turns.
 *
 * The load-bearing detail is that only TRUE is sent. The column went unwritten
 * until that date, so every earlier turn reads `false` in the database and none
 * of those falses mean anything — sending them would convert an unknown into a
 * claim, and the judge would condition on it.
 */
describe('DriftJudgeRepository.buildTranscript — interrupted turns', () => {
  let repository: DriftJudgeRepository;
  let query: jest.Mock;

  /** `interrupted` mirrors what `metadata->>'interrupted'` returns: text or null. */
  const messages = (flags: (string | null)[]) => [
    { sender_id: 1, content: 'how has the week been?', interrupted: null },
    { sender_id: -1, content: 'I', interrupted: flags[0] ?? null },
    { sender_id: 1, content: 'sorry, go on', interrupted: null },
    {
      sender_id: -1,
      content: 'it has been hard',
      interrupted: flags[1] ?? null,
    },
  ];

  const build = async (flags: (string | null)[]) => {
    query = jest.fn(async () => messages(flags));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftJudgeRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(DriftJudgeRepository);
    return repository.buildTranscript('sess-1');
  };

  const clientTurns = (t: { transcript: unknown[] }) =>
    (
      t.transcript as {
        role: string;
        turn_index?: number;
        interrupted?: boolean;
      }[]
    ).filter((x) => x.role === 'client');

  it('marks the client turn the learner talked over', async () => {
    const out = await build(['true']);
    const turns = clientTurns(out);

    expect(turns[0]).toMatchObject({ turn_index: 0, interrupted: true });
  });

  it('omits the key entirely on turns the worker reported as completed', async () => {
    // Not `interrupted: false` — absence is what tells the judge "unknown", and
    // an explicit false would read as "known not to be interrupted".
    const out = await build(['true', 'false']);
    const turns = clientTurns(out);

    expect(turns[1]).not.toHaveProperty('interrupted');
  });

  it('omits it from every turn when the worker reported nothing', async () => {
    // An older worker sends no flag at all: the transcript comes out
    // byte-identical to what it was before this change.
    const out = await build([null, null]);

    for (const turn of clientTurns(out)) {
      expect(turn).not.toHaveProperty('interrupted');
    }
  });

  it('never marks a counsellor turn', async () => {
    // Turn indices belong to client turns; a counsellor turn has none, so an
    // index-keyed flag must not leak onto one.
    const out = await build(['true', 'true']);
    const counsellor = (
      out.transcript as { role: string; interrupted?: boolean }[]
    ).filter((x) => x.role === 'counselor');

    expect(counsellor.length).toBeGreaterThan(0);
    for (const turn of counsellor) {
      expect(turn).not.toHaveProperty('interrupted');
    }
  });

  it('reads the flag off the message, not off turn metrics', async () => {
    // The message's own metadata is the authoritative per-utterance signal. The
    // turn-metrics column it replaced went unwritten before 2026-08-17, existed
    // only on `pipeline` rows, and was reconstructed from a playback handler.
    await build(['true']);
    const sql = query.mock.calls.map((c) => String(c[0])).join('\n');

    expect(sql).toMatch(/metadata->>'interrupted'/);
    expect(sql).not.toMatch(/scenario_session_turn_metrics/);
  });
});
