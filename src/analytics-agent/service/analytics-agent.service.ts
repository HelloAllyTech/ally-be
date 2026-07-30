import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../../config/config.service';
import { AuditLoggerService } from '../../audit/service/audit-logger.service';
import { LoggerService } from '../../logger/logger.service';
import {
  AGENT_LIMITS,
  DENIED_COLUMNS,
} from '../constants/analytics-agent.constants';
import {
  AnalyticsAgentCatalogResponseDto,
  AnalyticsAgentChartDto,
  AnalyticsAgentChartType,
  AnalyticsAgentOutcome,
  AnalyticsAgentTurnDto,
  AskAnalyticsAgentDto,
  AskAnalyticsAgentResponseDto,
} from '../dto/analytics-agent.dto';
import { guardSelectQuery } from '../util/sql-guard.util';
import { SchemaCatalogService } from './schema-catalog.service';
import { SqlExecutorService } from './sql-executor.service';

/** ally-ai's planning response. */
interface AiPlanResponse {
  planner_model: string;
  prompt_version: string;
  plan: {
    intent: 'sql' | 'clarify' | 'refuse';
    sql: string;
    rationale: string;
    message: string;
  };
}

/** ally-ai's narration response. */
interface AiAnswerResponse {
  answer_model: string;
  prompt_version: string;
  result: {
    answer: string;
    chart: {
      type: string;
      x: string;
      y: string;
      group: string;
      x_label: string;
      y_label: string;
      title: string;
    };
    caveats: string[];
    follow_ups: string[];
  };
}

/**
 * The Analytics Agent: one English question in, one answered (or honestly
 * unanswered) turn out.
 *
 * The pipeline is deliberately four separable steps, and this service owns the
 * three that involve the database:
 *
 *   question -> [ally-ai plans] -> [guard] -> [read-only execute] -> [ally-ai narrates]
 *
 * ally-ai never sees a connection string and never chooses what is readable; it
 * sees a catalogue this service rendered and rows this service decided to send.
 * That split is what makes the feature auditable: everything that could expose
 * data is in ally-be, in three files, and the LLM half can be re-prompted or
 * swapped without reopening the security question.
 */
@Injectable()
export class AnalyticsAgentService {
  private readonly logger = LoggerService.getInstance(
    AnalyticsAgentService.name,
  );
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly schemaCatalog: SchemaCatalogService,
    private readonly executor: SqlExecutorService,
    private readonly config: AppConfigService,
  ) {}

  async ask(
    dto: AskAnalyticsAgentDto,
    userId?: number,
  ): Promise<AskAnalyticsAgentResponseDto> {
    const question = (dto.question ?? '').trim();
    if (!question) throw new BadRequestException('question is required');

    const catalog = await this.schemaCatalog.render();
    // Oldest turns are dropped rather than refused: a long thread should get
    // shallower context, not an error at turn nine.
    const history = (dto.history ?? []).slice(-AGENT_LIMITS.MAX_HISTORY_TURNS);

    const planned = await this.planWithOneRetry(question, catalog, history);
    const { plan, plannerModel, promptVersion } = planned;

    if (plan.intent !== 'sql') {
      return this.emptyResponse({
        question,
        outcome:
          plan.intent === 'clarify'
            ? AnalyticsAgentOutcome.CLARIFY
            : AnalyticsAgentOutcome.REFUSED,
        message: plan.message,
        plannerModel,
        promptVersion,
      });
    }

    const guard = guardSelectQuery(plan.sql);
    if (!guard.ok) {
      // Logged at warn: a rejection is either a prompt that needs tightening or
      // someone probing the boundary, and both are worth seeing in the logs.
      this.logger.warn(
        `analytics agent rejected generated SQL: ${guard.reason} | question="${question}"`,
      );
      void this.audit(userId, {
        outcome: AnalyticsAgentOutcome.REJECTED,
        question,
        sql: plan.sql,
        reason: guard.reason,
      });
      return this.emptyResponse({
        question,
        outcome: AnalyticsAgentOutcome.REJECTED,
        message: `I could not run that safely: ${guard.reason}.`,
        sql: plan.sql,
        rationale: plan.rationale,
        plannerModel,
        promptVersion,
      });
    }

    let result;
    try {
      result = await this.executor.run(guard.sql);
    } catch (error) {
      const detail = this.summariseDbError(error);
      this.logger.error(
        `analytics agent query failed: ${detail} | sql=${guard.sql.replace(/\s+/g, ' ')}`,
      );
      void this.audit(userId, {
        outcome: AnalyticsAgentOutcome.FAILED,
        question,
        sql: guard.sql,
        reason: detail,
      });
      return this.emptyResponse({
        question,
        outcome: AnalyticsAgentOutcome.FAILED,
        message: `The query failed to run: ${detail}`,
        sql: guard.sql,
        rationale: plan.rationale,
        plannerModel,
        promptVersion,
      });
    }

    void this.audit(userId, {
      outcome: AnalyticsAgentOutcome.ANSWER,
      question,
      sql: guard.sql,
      rowCount: result.rows.length,
      durationMs: result.durationMs,
    });

    const narration = await this.narrate({
      question,
      sql: guard.sql,
      columns: result.columns,
      // Only a sample reaches the LLM. The reader gets every capped row in the
      // table; the narrator gets as many as are useful to describe them.
      rows: result.rows.slice(0, AGENT_LIMITS.NARRATION_ROW_LIMIT),
      rowCount: result.rows.length,
      truncated:
        result.truncated ||
        result.rows.length > AGENT_LIMITS.NARRATION_ROW_LIMIT,
      history,
    });

    return {
      outcome: AnalyticsAgentOutcome.ANSWER,
      question,
      message: '',
      answer: narration.result.answer,
      sql: guard.sql,
      rationale: plan.rationale,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: result.truncated,
      chart: this.toChartDto(narration.result.chart),
      caveats: narration.result.caveats ?? [],
      followUps: narration.result.follow_ups ?? [],
      durationMs: result.durationMs,
      provenance: {
        plannerModel,
        answerModel: narration.answer_model,
        promptVersion,
      },
    };
  }

  /** The readable catalogue, for the "what can I ask about?" panel. */
  async getCatalog(): Promise<AnalyticsAgentCatalogResponseDto> {
    const tables = await this.schemaCatalog.getCatalog();
    return {
      tables: tables.map((table) => ({
        name: table.name,
        purpose: table.purpose,
        columns: table.columns.map((column) => column.name),
      })),
      deniedColumns: [...DENIED_COLUMNS],
      rowLimit: AGENT_LIMITS.ROW_LIMIT,
    };
  }

  /**
   * Plan, and if the guard refuses the result, plan once more with the refusal
   * as context.
   *
   * One retry, not a loop. Most rejections are a single fixable slip — a denied
   * column used in a COUNT, a trailing second statement — and telling the planner
   * what was wrong fixes them. A loop, by contrast, spends a reader's minute and
   * two more model calls converging on the same refusal, and hides the fact that
   * the question needs rephrasing. The refusal is fed back through the existing
   * history field rather than a new one, so ally-ai's contract stays unchanged.
   */
  private async planWithOneRetry(
    question: string,
    catalog: string,
    history: AnalyticsAgentTurnDto[],
  ): Promise<{
    plan: AiPlanResponse['plan'];
    plannerModel: string;
    promptVersion: string;
  }> {
    const first = await this.planViaAi(question, catalog, history);
    if (first.plan.intent !== 'sql') return this.planResult(first);

    const guard = guardSelectQuery(first.plan.sql);
    if (guard.ok) return this.planResult(first);

    this.logger.debug(
      `analytics agent re-planning after rejection: ${guard.reason}`,
    );
    const retryHistory: AnalyticsAgentTurnDto[] = [
      ...history,
      {
        question,
        sql: first.plan.sql,
        answer:
          `REJECTED by the query guard: ${guard.reason}. ` +
          'Write a query that avoids this, or return intent="refuse" if the ' +
          'question cannot be answered within the rules.',
      },
    ];
    const second = await this.planViaAi(question, catalog, retryHistory);
    return this.planResult(second);
  }

  private planResult(response: AiPlanResponse) {
    return {
      plan: response.plan,
      plannerModel: response.planner_model,
      promptVersion: response.prompt_version,
    };
  }

  private async planViaAi(
    question: string,
    catalog: string,
    history: AnalyticsAgentTurnDto[],
  ): Promise<AiPlanResponse> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await axios.post(
      `${apiUrl}/api/v1/analytics-agent/plan`,
      {
        question,
        schema_catalog: catalog,
        // ally-be's date, so "last 30 days" is anchored to the server that runs
        // the query rather than to the model's idea of today.
        today: new Date().toISOString().slice(0, 10),
        row_limit: AGENT_LIMITS.ROW_LIMIT,
        history: history.map((turn) => ({
          question: turn.question,
          sql: turn.sql ?? '',
          answer: turn.answer ?? '',
        })),
      },
      {
        headers: { 'x-api-key': outboundApiKey },
        timeout: AGENT_LIMITS.AI_TIMEOUT_MS,
      },
    );
    return res.data as AiPlanResponse;
  }

  private async narrate(input: {
    question: string;
    sql: string;
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
    history: AnalyticsAgentTurnDto[];
  }): Promise<AiAnswerResponse> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await axios.post(
      `${apiUrl}/api/v1/analytics-agent/answer`,
      {
        question: input.question,
        sql: input.sql,
        columns: input.columns,
        rows: input.rows,
        row_count: input.rowCount,
        truncated: input.truncated,
        history: input.history.map((turn) => ({
          question: turn.question,
          sql: turn.sql ?? '',
          answer: turn.answer ?? '',
        })),
      },
      {
        headers: { 'x-api-key': outboundApiKey },
        timeout: AGENT_LIMITS.AI_TIMEOUT_MS,
      },
    );
    return res.data as AiAnswerResponse;
  }

  private toChartDto(
    chart: AiAnswerResponse['result']['chart'],
  ): AnalyticsAgentChartDto | null {
    if (!chart || !chart.type || chart.type === 'none') return null;
    const type = Object.values(AnalyticsAgentChartType).find(
      (value) => value === chart.type,
    );
    // An unrecognised chart type is dropped rather than passed through: the
    // client would have no renderer for it, and an empty panel reads as broken.
    if (!type || type === AnalyticsAgentChartType.NONE) return null;
    return {
      type,
      x: chart.x ?? '',
      y: chart.y ?? '',
      group: chart.group ?? '',
      xLabel: chart.x_label ?? '',
      yLabel: chart.y_label ?? '',
      title: chart.title ?? '',
    };
  }

  /**
   * A one-line, safe summary of a database error.
   *
   * Postgres error text can quote the offending row, so the raw message is not
   * something to hand to a browser. Timeouts get their own sentence because they
   * are the one failure the reader can act on — a narrower question will run.
   */
  private summariseDbError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/statement timeout|canceling statement/i.test(message)) {
      return `it took longer than ${AGENT_LIMITS.STATEMENT_TIMEOUT_MS / 1000}s. Try narrowing the period or the grouping.`;
    }
    if (/column .* does not exist/i.test(message)) {
      return 'it referenced a column that does not exist. Try rephrasing the question.';
    }
    if (/relation .* does not exist/i.test(message)) {
      return 'it referenced a table that is not readable. Try rephrasing the question.';
    }
    if (/read-only transaction/i.test(message)) {
      return 'it tried to modify data, which is never allowed.';
    }
    if (/syntax error/i.test(message)) {
      return 'the generated SQL was not valid. Try rephrasing the question.';
    }
    return 'the database refused it. Try rephrasing the question.';
  }

  /**
   * Audit every question that reached the database, plus every refusal.
   *
   * A surface that can read platform-wide data on a free-text prompt needs a
   * record of what was actually read, not just that someone opened the tab.
   * Fire-and-forget so auditing never delays or fails an answer.
   */
  private async audit(
    userId: number | undefined,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogger.log({
      eventType: 'ANALYTICS_AGENT_QUERY',
      userId,
      details,
    });
  }

  private emptyResponse(input: {
    question: string;
    outcome: AnalyticsAgentOutcome;
    message: string;
    sql?: string;
    rationale?: string;
    plannerModel: string;
    promptVersion: string;
  }): AskAnalyticsAgentResponseDto {
    return {
      outcome: input.outcome,
      question: input.question,
      message: input.message,
      answer: '',
      sql: input.sql ?? '',
      rationale: input.rationale ?? '',
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      chart: null,
      caveats: [],
      followUps: [],
      durationMs: 0,
      provenance: {
        plannerModel: input.plannerModel,
        // No narration ran, and saying so is more useful than naming a model
        // that had no part in this response.
        answerModel: '',
        promptVersion: input.promptVersion,
      },
    };
  }
}
