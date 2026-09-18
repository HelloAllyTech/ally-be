import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { AnalyticsAgentService } from '../analytics-agent.service';
import { SchemaCatalogService } from '../schema-catalog.service';
import { SqlExecutorService } from '../sql-executor.service';
import { AGENT_LIMITS } from '../../constants/analytics-agent.constants';
import {
  AnalyticsAgentChartType,
  AnalyticsAgentOutcome,
} from '../../dto/analytics-agent.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** ally-ai's /plan response. */
const planResponse = (plan: {
  intent: 'sql' | 'clarify' | 'refuse';
  sql?: string;
  rationale?: string;
  message?: string;
}) => ({
  data: {
    planner_model: 'gemini-test-planner',
    prompt_version: 'v1',
    plan: { sql: '', rationale: '', message: '', ...plan },
  },
});

/** ally-ai's /answer response. */
const answerResponse = (overrides: Record<string, unknown> = {}) => ({
  data: {
    answer_model: 'gemini-test-answer',
    prompt_version: 'v1',
    result: {
      answer: 'There were 42 sessions.',
      chart: {
        type: 'line',
        x: 'bucket',
        y: 'n',
        group: '',
        x_label: 'Week',
        y_label: 'Sessions',
        title: 'Sessions per week',
      },
      caveats: ['n = 42'],
      follow_ups: ['And by language?'],
      ...overrides,
    },
  },
});

describe('AnalyticsAgentService', () => {
  let service: AnalyticsAgentService;
  let executor: { run: jest.Mock };
  let catalog: { render: jest.Mock; getCatalog: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    catalog = {
      render: jest
        .fn()
        .mockResolvedValue(
          'TABLE scenario_sessions — runs\n  COLUMNS: id uuid',
        ),
      getCatalog: jest.fn().mockResolvedValue([
        {
          name: 'scenario_sessions',
          purpose: 'runs',
          columns: [{ name: 'id', type: 'uuid', nullable: false }],
        },
      ]),
    };
    executor = {
      run: jest.fn().mockResolvedValue({
        columns: ['bucket', 'n'],
        rows: [
          { bucket: '2026-07-01', n: 12 },
          { bucket: '2026-07-08', n: 30 },
        ],
        truncated: false,
        durationMs: 24,
      }),
    };
    service = new AnalyticsAgentService(
      catalog as unknown as SchemaCatalogService,
      executor as unknown as SqlExecutorService,
      { ai: { apiUrl: 'http://ai.test', outboundApiKey: 'k' } } as never,
    );
  });

  it('rejects an empty question without calling anything', async () => {
    await expect(service.ask({ question: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('answers a question end to end and reports both models as provenance', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT 1 AS bucket, 2 AS n FROM analytics_agent_scenario_sessions LIMIT 10',
          rationale: 'Counts sessions per week.',
        }),
      )
      .mockResolvedValueOnce(answerResponse());

    const result = await service.ask({ question: 'Sessions per week?' });

    expect(result.outcome).toBe(AnalyticsAgentOutcome.ANSWER);
    expect(result.answer).toBe('There were 42 sessions.');
    expect(result.rationale).toBe('Counts sessions per week.');
    expect(result.columns).toEqual(['bucket', 'n']);
    expect(result.rowCount).toBe(2);
    expect(result.chart).toEqual({
      type: AnalyticsAgentChartType.LINE,
      x: 'bucket',
      y: 'n',
      group: '',
      xLabel: 'Week',
      yLabel: 'Sessions',
      title: 'Sessions per week',
    });
    expect(result.caveats).toEqual(['n = 42']);
    expect(result.followUps).toEqual(['And by language?']);
    expect(result.provenance).toEqual({
      plannerModel: 'gemini-test-planner',
      answerModel: 'gemini-test-answer',
      promptVersion: 'v1',
    });
  });

  it('returns the SQL alongside the answer, so the number is auditable', async () => {
    const sql =
      'SELECT 1 AS bucket, 2 AS n FROM analytics_agent_scenario_sessions LIMIT 10';
    mockedAxios.post
      .mockResolvedValueOnce(planResponse({ intent: 'sql', sql }))
      .mockResolvedValueOnce(answerResponse());

    const result = await service.ask({ question: 'q' });
    expect(result.sql).toBe(sql);
  });

  it('passes a clarifying question through without running anything', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      planResponse({ intent: 'clarify', message: 'Which period?' }),
    );

    const result = await service.ask({ question: 'how are we doing?' });

    expect(result.outcome).toBe(AnalyticsAgentOutcome.CLARIFY);
    expect(result.message).toBe('Which period?');
    expect(executor.run).not.toHaveBeenCalled();
    // Only the planner was called: no narration of a query that never ran.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(result.provenance.answerModel).toBe('');
  });

  it('passes a refusal through as its own outcome', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      planResponse({
        intent: 'refuse',
        message: 'Message content is not readable.',
      }),
    );

    const result = await service.ask({ question: 'show me what people said' });

    expect(result.outcome).toBe(AnalyticsAgentOutcome.REFUSED);
    expect(result.message).toContain('not readable');
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('re-plans once when the guard refuses the first query, and uses the second', async () => {
    mockedAxios.post
      // First plan reads a denied column.
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT email FROM analytics_agent_users LIMIT 10',
        }),
      )
      // Second plan, given the refusal as context, avoids it.
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
        }),
      )
      .mockResolvedValueOnce(answerResponse());

    const result = await service.ask({ question: 'how many users?' });

    expect(result.outcome).toBe(AnalyticsAgentOutcome.ANSWER);
    expect(result.sql).toBe(
      'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
    );
    // plan, re-plan, narrate.
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('tells the planner why the first query was refused', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT email FROM analytics_agent_users LIMIT 10',
        }),
      )
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
        }),
      )
      .mockResolvedValueOnce(answerResponse());

    await service.ask({ question: 'how many users?' });

    const retryBody = mockedAxios.post.mock.calls[1][1] as {
      history: { answer: string }[];
    };
    const lastTurn = retryBody.history[retryBody.history.length - 1];
    expect(lastTurn.answer).toContain('REJECTED by the query guard');
    expect(lastTurn.answer).toContain('email');
  });

  it('reports a rejection after the retry, showing the SQL it refused', async () => {
    const bad = 'SELECT email FROM analytics_agent_users LIMIT 10';
    mockedAxios.post
      .mockResolvedValueOnce(planResponse({ intent: 'sql', sql: bad }))
      .mockResolvedValueOnce(planResponse({ intent: 'sql', sql: bad }));

    const result = await service.ask({ question: 'emails please' });

    expect(result.outcome).toBe(AnalyticsAgentOutcome.REJECTED);
    expect(result.message).toContain('could not run that safely');
    expect(result.sql).toBe(bad);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('turns a statement timeout into advice the reader can act on', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      planResponse({
        intent: 'sql',
        sql: 'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
      }),
    );
    executor.run.mockRejectedValueOnce(
      new Error('canceling statement due to statement timeout'),
    );

    const result = await service.ask({ question: 'everything, all time' });

    expect(result.outcome).toBe(AnalyticsAgentOutcome.FAILED);
    expect(result.message).toMatch(/took longer than/);
    expect(result.message).toMatch(/narrowing/);
  });

  it('does not leak raw database error text to the client', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      planResponse({
        intent: 'sql',
        sql: 'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
      }),
    );
    executor.run.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "x" DETAIL: Key (email)=(a@b.c)',
      ),
    );

    const result = await service.ask({ question: 'q' });

    expect(result.outcome).toBe(AnalyticsAgentOutcome.FAILED);
    expect(result.message).not.toContain('a@b.c');
  });

  it('sends only a sample of rows for narration, and marks it truncated', async () => {
    const rows = Array.from(
      { length: AGENT_LIMITS.NARRATION_ROW_LIMIT + 25 },
      (_, i) => ({
        bucket: `d${i}`,
        n: i,
      }),
    );
    executor.run.mockResolvedValueOnce({
      columns: ['bucket', 'n'],
      rows,
      truncated: false,
      durationMs: 10,
    });
    mockedAxios.post
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT 1 AS bucket, 1 AS n FROM analytics_agent_users LIMIT 500',
        }),
      )
      .mockResolvedValueOnce(
        answerResponse({
          chart: {
            type: 'none',
            x: '',
            y: '',
            group: '',
            x_label: '',
            y_label: '',
            title: '',
          },
        }),
      );

    const result = await service.ask({ question: 'daily counts' });

    const narrationBody = mockedAxios.post.mock.calls[1][1] as {
      rows: unknown[];
      truncated: boolean;
      row_count: number;
    };
    expect(narrationBody.rows).toHaveLength(AGENT_LIMITS.NARRATION_ROW_LIMIT);
    // The narrator is told its view is partial, so it will not state a total.
    expect(narrationBody.truncated).toBe(true);
    expect(narrationBody.row_count).toBe(rows.length);
    // The reader still gets every capped row for the table.
    expect(result.rows).toHaveLength(rows.length);
    expect(result.chart).toBeNull();
  });

  it('forwards only the most recent turns of history', async () => {
    const history = Array.from(
      { length: AGENT_LIMITS.MAX_HISTORY_TURNS + 4 },
      (_, i) => ({
        question: `q${i}`,
        sql: '',
        answer: `a${i}`,
      }),
    );
    mockedAxios.post
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
        }),
      )
      .mockResolvedValueOnce(answerResponse());

    await service.ask({ question: 'follow up', history });

    const planBody = mockedAxios.post.mock.calls[0][1] as {
      history: { question: string }[];
    };
    expect(planBody.history).toHaveLength(AGENT_LIMITS.MAX_HISTORY_TURNS);
    // Kept the newest, dropped the oldest.
    expect(planBody.history[planBody.history.length - 1].question).toBe(
      `q${history.length - 1}`,
    );
    expect(planBody.history.map((t) => t.question)).not.toContain('q0');
  });

  it("anchors relative periods to this server's date and passes the row cap", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
        }),
      )
      .mockResolvedValueOnce(answerResponse());

    await service.ask({ question: 'last 30 days' });

    const planBody = mockedAxios.post.mock.calls[0][1] as {
      today: string;
      row_limit: number;
      schema_catalog: string;
    };
    expect(planBody.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(planBody.row_limit).toBe(AGENT_LIMITS.ROW_LIMIT);
    expect(planBody.schema_catalog).toContain('scenario_sessions');
  });

  it('drops a chart type the client has no renderer for', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(
        planResponse({
          intent: 'sql',
          sql: 'SELECT count(*) AS n FROM analytics_agent_users LIMIT 1',
        }),
      )
      .mockResolvedValueOnce(
        answerResponse({
          chart: {
            type: 'sunburst',
            x: 'bucket',
            y: 'n',
            group: '',
            x_label: '',
            y_label: '',
            title: '',
          },
        }),
      );

    const result = await service.ask({ question: 'q' });
    expect(result.chart).toBeNull();
  });

  it('exposes the readable catalogue with the denied-column policy and row cap', async () => {
    const result = await service.getCatalog();

    expect(result.tables[0]).toEqual({
      name: 'scenario_sessions',
      purpose: 'runs',
      columns: ['id'],
    });
    expect(result.deniedColumns).toContain('password');
    expect(result.deniedColumns).toContain('email');
    expect(result.rowLimit).toBe(AGENT_LIMITS.ROW_LIMIT);
  });
});
