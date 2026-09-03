import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { DriftJudgeRepository } from '../drift-judge.repository';

/**
 * A thinking filler and an interim reply are persisted as AI-sender rows, the
 * same as the character's real reply. Before `utteranceKind` existed, every
 * "Hmm" therefore took a turn index and reached the language judge as if it
 * were a turn of roleplay.
 *
 * Two things broke as a result, and both get worse as filler rollout widens:
 * `turnsJudged` — the denominator under every error rate on the language
 * dashboard — counted utterances that are SUPPOSED to be contentless, and the
 * judge was invited to annotate them for being exactly that.
 */
describe('DriftJudgeRepository.buildTranscript — filler and interim lines', () => {
  let repository: DriftJudgeRepository;
  let query: jest.Mock;

  /** `utterance_kind` mirrors `metadata->>'utteranceKind'`: text or null. */
  const build = async (
    rows: { sender_id: number; content: string; utterance_kind?: string }[],
  ) => {
    query = jest.fn(async () =>
      rows.map((r) => ({
        sender_id: r.sender_id,
        content: r.content,
        interrupted: null,
        utterance_kind: r.utterance_kind ?? null,
      })),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftJudgeRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(DriftJudgeRepository);
    return repository.buildTranscript('sess-1');
  };

  const counselor = (content: string) => ({ sender_id: 1, content });
  const ai = (content: string, kind?: string) => ({
    sender_id: -1,
    content,
    utterance_kind: kind,
  });

  it('keeps the filler out of the transcript entirely', async () => {
    const out = await build([
      counselor('I lost my job last week.'),
      ai('Hmm', 'filler'),
      ai('That sounds like a lot to carry.', 'reply'),
    ]);

    expect(out.transcript.map((t) => t.text)).toEqual([
      'I lost my job last week.',
      'That sounds like a lot to carry.',
    ]);
  });

  it('keeps the interim reply out too', async () => {
    // An interim is a different feature with different rules — it is allowed to
    // say something — but it is equally not a turn of roleplay.
    const out = await build([
      counselor('I do not know where to start.'),
      ai('Take your time.', 'interim'),
      ai('Start wherever feels easiest.', 'reply'),
    ]);

    expect(out.transcript.map((t) => t.text)).toEqual([
      'I do not know where to start.',
      'Start wherever feels easiest.',
    ]);
  });

  it('does not spend a turn index on a skipped line', async () => {
    // The load-bearing assertion. Turn indices are the join key the judge
    // annotates against and the denominator the dashboard divides by, so a
    // filler consuming index 0 shifts every real turn AND inflates the count.
    const out = await build([
      counselor('First thing.'),
      ai('Hmm', 'filler'),
      ai('Reply one.', 'reply'),
      counselor('Second thing.'),
      ai('Let me think', 'filler'),
      ai('Reply two.', 'reply'),
    ]);

    expect(out.aiText).toEqual({ 0: 'Reply one.', 1: 'Reply two.' });
    expect(out.userText).toEqual({ 0: 'First thing.', 1: 'Second thing.' });
  });

  it('still pairs the reply with the learner turn it answered', async () => {
    // A skipped filler must not become the "last counsellor utterance" or
    // anything else that shifts the pairing the judge reads.
    const out = await build([
      counselor('Something happened.'),
      ai('Hmm', 'filler'),
      ai('Go on.', 'reply'),
    ]);

    expect(out.userText[0]).toBe('Something happened.');
  });

  it('treats an unmarked AI line as a real reply', async () => {
    // Every message written before the worker sent `utteranceKind` carries no
    // marker. Those are overwhelmingly real replies, and guessing "filler"
    // would silently shrink the historical corpus the dashboard trends on.
    const out = await build([counselor('Hello.'), ai('Hello back.')]);

    expect(out.aiText).toEqual({ 0: 'Hello back.' });
  });

  it('never drops a counsellor line, whatever marker it carries', async () => {
    // The marker describes the CLIENT's utterance kind. A learner line is never
    // a filler, so a stray value on one must not remove the learner from the
    // transcript.
    const out = await build([
      { sender_id: 1, content: 'I am here.', utterance_kind: 'filler' },
      ai('Good to hear.', 'reply'),
    ]);

    expect(out.transcript.map((t) => t.role)).toEqual(['counselor', 'client']);
  });

  it('reads the marker off the message row', async () => {
    await build([counselor('Hi.'), ai('Hmm', 'filler')]);
    const sql = query.mock.calls.map((c) => String(c[0])).join('\n');

    expect(sql).toMatch(/metadata->>'utteranceKind'/);
  });
});
