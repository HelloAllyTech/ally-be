import { DataSource } from 'typeorm';
import {
  RecallQualityRepository,
  RecallTurnRow,
} from '../recall-quality.repository';

/**
 * The pairing is what these tests exist for.
 *
 * `turnIndex` counts LEARNER turns, 1-based, because the worker's store pre-increments once
 * per learner turn before the reply is generated. Turn N is therefore the Nth counsellor
 * message and the client message that follows it. Off by one and the judge does not fail — it
 * returns a confident verdict about a conversation that never happened, and nothing
 * downstream could tell. So every case where the transcript cannot support the index must
 * return null rather than something plausible.
 */
describe('RecallQualityRepository', () => {
  let query: jest.Mock;
  let repository: RecallQualityRepository;

  const turn: RecallTurnRow = {
    id: 'sel-1',
    tenant_id: 'tenant-1',
    scenario_session_id: 'sess-1',
    turn_index: 2,
    stance: 'guarded',
    cue_tier: 'nominated',
    pool_size: 12,
    selected: [{ text: 'she ran a tailoring shop' }],
    passed_over: [{ text: 'her son stopped visiting' }],
    occurred_at: new Date('2026-09-11T09:00:00Z'),
  };

  // A session that opens with the client, as these sessions do.
  const transcript = [
    { sender_id: -1, content: 'They told me to come here.' },
    { sender_id: 7, content: 'What brought you in today?' },
    { sender_id: -1, content: "I don't really know." },
    { sender_id: 7, content: 'Tell me about your family.' },
    { sender_id: -1, content: "There's not much to tell." },
  ];

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    repository = new RecallQualityRepository({
      query,
    } as unknown as DataSource);
  });

  describe('buildTurnText', () => {
    it('pairs turn N with the Nth counsellor message and the reply after it', async () => {
      query.mockResolvedValue(transcript);
      const text = await repository.buildTurnText('sess-1', 2);
      expect(text).toEqual({
        counsellor_turn: 'Tell me about your family.',
        client_reply: "There's not much to tell.",
      });
    });

    it('does not count the client opening as a turn', async () => {
      // The client speaks first. Counting that message would shift every pairing by one and
      // silently judge each decision against the previous turn.
      query.mockResolvedValue(transcript);
      const text = await repository.buildTurnText('sess-1', 1);
      expect(text?.counsellor_turn).toBe('What brought you in today?');
      expect(text?.client_reply).toBe("I don't really know.");
    });

    it('returns null when the transcript has fewer turns than the index claims', async () => {
      // A session that ended mid-turn, or any drift in the convention. Null, not the last
      // turn available.
      query.mockResolvedValue(transcript);
      expect(await repository.buildTurnText('sess-1', 9)).toBeNull();
    });

    it('returns null for a turn index below one', async () => {
      // The counter is 1-based; a 0 means something upstream is not what this assumes.
      query.mockResolvedValue(transcript);
      expect(await repository.buildTurnText('sess-1', 0)).toBeNull();
    });

    it('returns null for an empty transcript', async () => {
      query.mockResolvedValue([]);
      expect(await repository.buildTurnText('sess-1', 1)).toBeNull();
    });

    it('keeps a turn whose reply never came, as long as the turn itself exists', async () => {
      // The learner's last turn before hanging up is still a real recall decision.
      query.mockResolvedValue([
        { sender_id: 7, content: 'Tell me about your family.' },
      ]);
      const text = await repository.buildTurnText('sess-1', 1);
      expect(text).toEqual({
        counsellor_turn: 'Tell me about your family.',
        client_reply: '',
      });
    });

    it('returns null when both halves are blank', async () => {
      query.mockResolvedValue([
        { sender_id: 7, content: '   ' },
        { sender_id: -1, content: '' },
      ]);
      expect(await repository.buildTurnText('sess-1', 1)).toBeNull();
    });

    it('reads the transcript in order', async () => {
      query.mockResolvedValue(transcript);
      await repository.buildTurnText('sess-1', 1);
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('ORDER BY "createdAt" ASC, id ASC');
    });
  });

  describe('selectTurns', () => {
    it('requires a pool, since an empty choice was never a ranking decision', async () => {
      await repository.selectTurns({ sinceDays: 7 });
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('jsonb_array_length');
      expect(sql).toContain('> 0');
    });

    it('scopes "already judged" to one model and rubric version', async () => {
      await repository.selectTurns({
        unjudgedForVersion: {
          judgeModel: 'gemini-2.5-pro',
          judgePromptVersion: 'v1',
        },
      });
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('wm_recall_judgments');
      expect(params).toEqual(['gemini-2.5-pro', 'v1']);
    });
  });

  describe('upsertJudgment', () => {
    it('upserts on (selection, model, rubric) so a re-judge coexists with the old', async () => {
      await repository.upsertJudgment(
        turn,
        { verdict: 'well_chosen' },
        'gemini-2.5-pro',
        'v1',
      );
      const [sql] = query.mock.calls[0];
      expect(sql).toContain(
        'ON CONFLICT (recall_selection_id, judge_model, judge_prompt_version)',
      );
    });

    it('stores the slice dimensions a rate has to be segmented by', async () => {
      // A guarded client withholding a fact recalled it fine, and a scenario-cued turn was
      // never driven by the conversation. Pooled, those are not a rate.
      await repository.upsertJudgment(
        turn,
        { verdict: 'missed_better', better_fact: 'her son stopped visiting' },
        'gemini-2.5-pro',
        'v1',
      );
      const [, params] = query.mock.calls[0];
      expect(params).toContain('guarded');
      expect(params).toContain('nominated');
      expect(params).toContain(12);
    });

    it('counts unused selections rather than storing their text', async () => {
      await repository.upsertJudgment(
        turn,
        { verdict: 'well_chosen', unused_selected: ['a', 'b', 'c'] },
        'gemini-2.5-pro',
        'v1',
      );
      const [, params] = query.mock.calls[0];
      expect(params).toContain(3);
    });

    it('stores a blank better_fact as NULL', async () => {
      // The judge names one only on missed_better, and ally-ai nulls an invented one. A blank
      // string here would read as "a fact, unnamed".
      await repository.upsertJudgment(
        turn,
        { verdict: 'well_chosen', better_fact: '   ' },
        'gemini-2.5-pro',
        'v1',
      );
      const [, params] = query.mock.calls[0];
      expect(params[5]).toBeNull();
    });

    it('timestamps by when the TURN happened, not when it was judged', async () => {
      await repository.upsertJudgment(
        turn,
        { verdict: 'well_chosen' },
        'gemini-2.5-pro',
        'v1',
      );
      const [, params] = query.mock.calls[0];
      expect(params).toContain(turn.occurred_at);
    });
  });
});
