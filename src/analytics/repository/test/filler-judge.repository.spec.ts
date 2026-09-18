import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { FillerJudgeRepository } from '../filler-judge.repository';

/**
 * `buildObservations` is where the real work is: a filler, an interim reply and
 * the real reply all land in `scenario_session_messages` as AI-sender rows, so
 * each played filler has to be paired with the learner turn it answered and the
 * reply that eventually followed. Getting the pairing or the ORDER wrong feeds
 * the judge a filler attached to the wrong moment, and its repeat-distance
 * arithmetic is counted in plays.
 */
describe('FillerJudgeRepository.buildObservations', () => {
  let repository: FillerJudgeRepository;
  let query: jest.Mock;

  /** Rows in the order the SQL returns them (by start time, then id). */
  const withMessages = (
    messages: { sender_id: number; content: string; utterance_kind?: string }[],
    metrics: {
      turn_index: number;
      source?: string;
      filler_type?: string;
    }[] = [],
  ) => {
    query.mockImplementation(async (sql: string) =>
      /scenario_session_turn_metrics/i.test(sql)
        ? metrics.map((m) => ({
            turn_index: m.turn_index,
            source: m.source ?? null,
            filler_type: m.filler_type ?? null,
          }))
        : messages.map((m) => ({
            sender_id: m.sender_id,
            content: m.content,
            utterance_kind: m.utterance_kind ?? null,
          })),
    );
  };

  const counselor = (content: string) => ({ sender_id: 1, content });
  const ai = (content: string, kind?: string) => ({
    sender_id: -1,
    content,
    utterance_kind: kind,
  });

  beforeEach(async () => {
    query = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillerJudgeRepository,
        { provide: DataSource, useValue: { query, transaction: jest.fn() } },
      ],
    }).compile();
    repository = module.get(FillerJudgeRepository);
  });

  it('pairs a filler with the turn it answered and the reply that followed', async () => {
    withMessages([
      counselor('I lost my job last week.'),
      ai('Hmm', 'filler'),
      ai('That sounds like a lot to carry.', 'reply'),
    ]);

    const observations = await repository.buildObservations('sess-1');

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      turn_index: 0,
      learner_utterance: 'I lost my job last week.',
      filler_text: 'Hmm',
      reply_text: 'That sounds like a lot to carry.',
    });
  });

  it('keeps BOTH fillers when a continuation plays on one turn', async () => {
    // The case that makes position-based inference impossible: two fillers
    // precede a single reply, and both were heard by the learner.
    withMessages([
      counselor('I have not slept.'),
      ai('Hmm', 'filler'),
      ai('Let me think', 'filler'),
      ai('That must be exhausting.', 'reply'),
    ]);

    const observations = await repository.buildObservations('sess-1');

    expect(observations.map((o) => o.filler_text)).toEqual([
      'Hmm',
      'Let me think',
    ]);
    // Both belong to the same turn and share the reply that answered it.
    expect(observations.every((o) => o.turn_index === 0)).toBe(true);
    expect(
      observations.every((o) => o.reply_text === 'That must be exhausting.'),
    ).toBe(true);
  });

  it('skips the interim reply, which is a different feature', async () => {
    // An interim is allowed to say something — that is the point of it — so it
    // must not be judged against a rubric that forbids committing to anything.
    withMessages([
      counselor('I do not know where to start.'),
      ai('Hmm', 'filler'),
      ai('Take your time, I am listening.', 'interim'),
      ai('Start wherever feels easiest.', 'reply'),
    ]);

    const observations = await repository.buildObservations('sess-1');

    expect(observations.map((o) => o.filler_text)).toEqual(['Hmm']);
    expect(observations[0].reply_text).toBe('Start wherever feels easiest.');
  });

  it('advances the turn index only on real replies', async () => {
    withMessages([
      counselor('First thing.'),
      ai('Hmm', 'filler'),
      ai('Reply one.', 'reply'),
      counselor('Second thing.'),
      ai('I see', 'filler'),
      ai('Reply two.', 'reply'),
    ]);

    const observations = await repository.buildObservations('sess-1');

    expect(observations.map((o) => o.turn_index)).toEqual([0, 1]);
    expect(observations.map((o) => o.learner_utterance)).toEqual([
      'First thing.',
      'Second thing.',
    ]);
  });

  it('keeps a filler whose turn never produced a reply', async () => {
    // The session ended mid-turn. The learner still heard the filler, so
    // dropping it would understate what was played.
    withMessages([counselor('Are you there?'), ai('Hmm', 'filler')]);

    const observations = await repository.buildObservations('sess-1');

    expect(observations).toHaveLength(1);
    expect(observations[0].reply_text).toBe('');
  });

  it('treats an unmarked AI line as a reply, not a filler', async () => {
    // Messages from a worker predating `utteranceKind` carry no marker. They
    // are far more likely to be real replies, and guessing "filler" would
    // fabricate observations out of ordinary turns.
    withMessages([counselor('Hello.'), ai('Hello back.')]);

    const observations = await repository.buildObservations('sess-1');

    expect(observations).toHaveLength(0);
  });

  it('attaches the provenance recorded on the turn-metrics row', async () => {
    // `in_turn` is the only generation path that had seen the current
    // utterance, so this slice is how that path's extra cost gets justified.
    withMessages(
      [
        counselor('Something happened.'),
        ai('Hmm', 'filler'),
        ai('Go on.', 'reply'),
      ],
      [{ turn_index: 0, source: 'in_turn', filler_type: 'hesitation' }],
    );

    const observations = await repository.buildObservations('sess-1');

    expect(observations[0].source).toBe('in_turn');
    expect(observations[0].filler_type).toBe('hesitation');
  });

  it('leaves provenance null when the metrics row is absent', async () => {
    withMessages([
      counselor('Something happened.'),
      ai('Hmm', 'filler'),
      ai('Go on.', 'reply'),
    ]);

    const observations = await repository.buildObservations('sess-1');

    expect(observations[0].source).toBeNull();
    expect(observations[0].filler_type).toBeNull();
  });
});

describe('FillerJudgeRepository.selectSessions', () => {
  let repository: FillerJudgeRepository;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn(async () => []);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillerJudgeRepository,
        { provide: DataSource, useValue: { query, transaction: jest.fn() } },
      ],
    }).compile();
    repository = module.get(FillerJudgeRepository);
  });

  it('only selects sessions that actually played a filler', async () => {
    // Most sessions play none — the feature is opt-in and the gate declines
    // fast turns — so judging them would spend a call to learn there was
    // nothing to judge.
    await repository.selectSessions({
      judgeModel: 'gemini-2.5-flash',
      judgePromptVersion: 'v1',
    });

    const [sql] = query.mock.calls[0];
    expect(sql).toContain("metadata->>'utteranceKind' = 'filler'");
  });

  it('skips sessions this judge version already covered', async () => {
    await repository.selectSessions({
      judgeModel: 'gemini-2.5-flash',
      judgePromptVersion: 'v1',
    });

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('filler_judgment_sessions');
    expect(sql).toContain('NOT EXISTS');
  });

  it('re-judges everything when asked', async () => {
    await repository.selectSessions({
      judgeModel: 'gemini-2.5-flash',
      judgePromptVersion: 'v1',
      rejudge: true,
    });

    const [sql] = query.mock.calls[0];
    expect(sql).not.toContain('filler_judgment_sessions');
  });
});
