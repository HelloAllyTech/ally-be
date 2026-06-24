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
    expect(params).toHaveLength(24);
    expect(params[14]).toBe(7); // scenarioId ($15)
    expect(params[23]).toBe('ver-abc'); // scenarioVersionId ($24)
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
