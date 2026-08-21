import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import {
  DriftJudgeRepository,
  DriftSessionRow,
  PerTurnJudgment,
} from '../drift-judge.repository';

describe('DriftJudgeRepository.upsertJudgments', () => {
  let repository: DriftJudgeRepository;
  let query: jest.Mock;

  const session: DriftSessionRow = {
    id: 'sess-1',
    tenant_id: 'tenant-1',
    scenario_id: 7,
    scenario_version_id: 'ver-abc',
    language: 'en',
    persona: null,
    prompt_versions: { ally_ai_main_agent_default: 3 },
    occurred_at: new Date('2026-01-01T00:00:00Z'),
    llm_provider: 'openai',
    llm_model: 'gpt-4o',
  };

  const perTurn: PerTurnJudgment[] = [
    {
      turn_index: 0,
      coherence: 'fully_coherent',
      topic_label: 'on_topic',
      in_character: true,
      counselor_utterance_garbled: 'none',
      stt_error_type: 'none',
      ai_reply_failure_mode: 'none',
      root_attribution: 'none',
      reasoning: 'fine',
    },
  ];

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftJudgeRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(DriftJudgeRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('denormalizes scenario_version_id onto each judgment row', async () => {
    await repository.upsertJudgments(
      session,
      perTurn,
      { drifted: false, first_drift_turn: null },
      'gemini-2.5-pro',
      'v1',
      { 0: 'ai text' },
      { 0: 'user text' },
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    // The column must be written and aligned to the last positional param.
    expect(sql).toContain('"scenarioVersionId"');
    expect(params).toHaveLength(30);
    expect(params[14]).toBe(7); // scenarioId ($15)
    expect(params[23]).toBe('ver-abc'); // scenarioVersionId ($24)
  });

  it('writes the v2 labels, and null for the ones the judge omitted', async () => {
    await repository.upsertJudgments(
      session,
      [
        {
          ...perTurn[0],
          role_inversion: true,
          offered_solution: false,
          solutions_offered: 3,
          introduced_new_information: false,
          // stuck_is_appropriate deliberately absent — a judge that did not
          // answer must land as null, never as a clean `false`, or "not
          // observed" becomes indistinguishable from "correctly moved on".
          resistance_briefed: true,
        },
      ],
      { drifted: false, first_drift_turn: null },
      'gemini-2.5-pro',
      'v2',
      { 0: 'ai text' },
      { 0: 'user text' },
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('"roleInversion"');
    expect(sql).toContain('"resistanceBriefed"');
    expect(params[24]).toBe(true); // roleInversion
    expect(params[25]).toBe(false); // offeredSolution
    expect(params[26]).toBe(3); // solutionsOffered
    expect(params[27]).toBe(false); // introducedNewInformation
    expect(params[28]).toBeNull(); // stuckIsAppropriate — omitted by the judge
    expect(params[29]).toBe(true); // resistanceBriefed
  });

  it('passes null when the session has no version (pre-versioning sessions)', async () => {
    await repository.upsertJudgments(
      { ...session, scenario_version_id: null },
      perTurn,
      { drifted: false, first_drift_turn: null },
      'gemini-2.5-pro',
      'v1',
      {},
      {},
    );

    const [, params] = query.mock.calls[0];
    expect(params[23]).toBeNull();
  });
});

describe('DriftJudgeRepository.mergeLeanLabels', () => {
  let repository: DriftJudgeRepository;
  let query: jest.Mock;

  const sourceVersion = {
    judgeModel: 'gemini-2.5-pro',
    judgePromptVersion: 'v1',
  };
  const targetVersion = {
    judgeModel: 'gemini-2.5-pro',
    judgePromptVersion: 'v2',
  };

  beforeEach(async () => {
    query = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftJudgeRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(DriftJudgeRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('counts a row that was actually written by the INSERT ... SELECT', async () => {
    // Postgres only returns rows for an INSERT when the query has a
    // RETURNING clause; this is what a row landing in the table looks like.
    query.mockResolvedValueOnce([{ scenarioSessionId: 'sess-1' }]);

    const merged = await repository.mergeLeanLabels(
      'sess-1',
      [{ turn_index: 0, role_inversion: true }],
      sourceVersion,
      targetVersion,
    );

    expect(merged).toBe(1);
  });

  it('does not count a turn whose INSERT ... SELECT matched no source row', async () => {
    query.mockResolvedValueOnce([]);

    const merged = await repository.mergeLeanLabels(
      'sess-1',
      [{ turn_index: 0, role_inversion: true }],
      sourceVersion,
      targetVersion,
    );

    expect(merged).toBe(0);
  });

  it('sums per-turn results across a mixed batch', async () => {
    query
      .mockResolvedValueOnce([{ scenarioSessionId: 'sess-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ scenarioSessionId: 'sess-1' }]);

    const merged = await repository.mergeLeanLabels(
      'sess-1',
      [
        { turn_index: 0, role_inversion: true },
        { turn_index: 1, role_inversion: false },
        { turn_index: 2, offered_solution: true },
      ],
      sourceVersion,
      targetVersion,
    );

    expect(merged).toBe(2);
  });
});
