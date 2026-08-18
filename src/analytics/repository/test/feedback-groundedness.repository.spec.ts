import { DataSource } from 'typeorm';
import {
  ClaimJudgment,
  FeedbackClaim,
  FeedbackGroundednessRepository,
  GroundednessSessionRow,
} from '../feedback-groundedness.repository';

describe('FeedbackGroundednessRepository', () => {
  let query: jest.Mock;
  let repository: FeedbackGroundednessRepository;

  const session: GroundednessSessionRow = {
    id: 'sess-1',
    tenant_id: 'tenant-1',
    scenario_id: 7,
    scenario_version_id: 'ver-abc',
    language: 'en-IN',
    llm_model: 'gpt-4o-mini',
    occurred_at: new Date('2026-03-15T10:00:00Z'),
  };

  const claims: FeedbackClaim[] = [
    {
      claim_index: 0,
      kind: 'positive',
      text: 'Reflected the client’s feeling.',
    },
    {
      claim_index: 0,
      kind: 'improvement',
      text: 'Never asked an open question.',
    },
  ];

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    repository = new FeedbackGroundednessRepository({
      query,
    } as unknown as DataSource);
  });

  describe('selectSessions', () => {
    it('requires transcript messages, so an agent-never-joined session is not judged', async () => {
      await repository.selectSessions({ sinceDays: 90 });
      const [sql] = query.mock.calls[0];
      // Judging claims against an empty transcript would mark every one
      // unsupported and manufacture a groundedness crisis out of sessions
      // where nothing was ever said.
      expect(sql).toContain('scenario_session_messages');
      expect(sql).toContain('EXISTS');
      expect(sql).toContain(`summary->'feedback' ? 'positives'`);
    });

    it('excludes previews, seed fixtures and test orgs', async () => {
      await repository.selectSessions({});
      const [sql] = query.mock.calls[0];
      expect(sql).toContain(`NOT LIKE 'preview-%'`);
      expect(sql).toContain(`NOT LIKE 'seed-room-%'`);
      expect(sql).toContain('isTestOrganization');
    });

    it('scopes "already judged" to one rubric version when asked', async () => {
      await repository.selectSessions({
        unjudgedForVersion: {
          judgeModel: 'gemini-2.5-pro',
          judgePromptVersion: 'v2',
        },
      });
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('feedback_claim_judgment');
      expect(sql).toContain('judgePromptVersion');
      expect(params).toContain('v2');
    });

    it('does not filter by version when none is given', async () => {
      await repository.selectSessions({ sinceDays: 30 });
      const [sql] = query.mock.calls[0];
      expect(sql).not.toContain('feedback_claim_judgment');
    });
  });

  describe('buildClaims', () => {
    it('indexes each claim within its own list, not across both', async () => {
      // (kind, index) is the identity used by the unique constraint. Indexing
      // across the concatenation would shift every improvement's id whenever
      // the number of positives changed, silently repointing stored verdicts.
      await repository.buildClaims('sess-1');
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('WITH ORDINALITY');
      expect(sql).toContain("'positive'");
      expect(sql).toContain("'improvement'");
      expect(sql).toContain('(ord - 1)');
    });

    it('drops blank claims', async () => {
      await repository.buildClaims('sess-1');
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('length(btrim(c.text)) > 0');
    });
  });

  describe('buildTranscript', () => {
    it('numbers only AI turns, and skips empty content', async () => {
      query.mockResolvedValueOnce([
        { sender_id: 5, content: 'Hello there' },
        { sender_id: -1, content: 'I have been struggling' },
        { sender_id: 5, content: '   ' },
        { sender_id: -1, content: 'It keeps happening' },
      ]);
      const out = await repository.buildTranscript('sess-1');
      expect(out).toEqual([
        { role: 'counselor', text: 'Hello there' },
        { role: 'client', text: 'I have been struggling', turn_index: 0 },
        { role: 'client', text: 'It keeps happening', turn_index: 1 },
      ]);
    });
  });

  describe('upsertJudgments', () => {
    const judgments: ClaimJudgment[] = [
      {
        claim_index: 0,
        kind: 'improvement',
        verdict: 'contradicted',
        quotes_transcript: true,
        quote_is_accurate: false,
        reasoning: 'The counsellor did ask an open question at turn 4.',
      },
    ];

    it('writes the verdict with the claim text it was judged against', async () => {
      await repository.upsertJudgments(
        session,
        claims,
        judgments,
        'gemini-2.5-pro',
        'v1',
      );
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT');
      expect(params[2]).toBe('improvement');
      expect(params[3]).toBe(0);
      expect(params[4]).toBe('contradicted');
      expect(params[5]).toBe(true); // quotesTranscript
      expect(params[6]).toBe(false); // quoteIsAccurate
      // Text is resolved by (kind, index) — not by position — so the improvement
      // claim's text lands here, not the positive one that shares index 0.
      expect(params[7]).toBe('Never asked an open question.');
    });

    it('upserts on the version key so a new rubric writes alongside the old', async () => {
      await repository.upsertJudgments(session, claims, judgments, 'g', 'v2');
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('"judgeModel"');
      expect(sql).toContain('"judgePromptVersion"');
      expect(sql).toContain('DO UPDATE SET');
    });

    it('stores null rather than false for labels the judge omitted', async () => {
      await repository.upsertJudgments(
        session,
        claims,
        [{ claim_index: 0, kind: 'positive', verdict: 'supported' }],
        'g',
        'v1',
      );
      const [, params] = query.mock.calls[0];
      expect(params[5]).toBeNull();
      expect(params[6]).toBeNull();
    });
  });
});
