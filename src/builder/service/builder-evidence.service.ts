import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AnalyticsAgentService } from 'src/analytics-agent/service/analytics-agent.service';
import { BugFindingService } from 'src/bug-hunter/service/bug-finding.service';
import { LogsService } from 'src/logs/logs.service';
import { UxSignalReadService } from 'src/ux-signals/service/ux-signal-read.service';
import { AwsLogServiceKey } from 'src/config/config.service';
import {
  BUILDER_EVIDENCE_ERROR_WINDOW_HOURS,
  BUILDER_EVIDENCE_MAX_SHAPES,
  BUILDER_EVIDENCE_TIMEOUT_MS,
} from '../constants/builder.constants';

/** Repos with a CloudWatch log group. The frontends have no server-side one. */
const LOGGED_REPOS: AwsLogServiceKey[] = [
  'ally-be',
  'ally-ai',
  'ally-ai-learn',
];

/**
 * What the running system says, for the interview to ground a PRD in.
 *
 * Until now the interview could reach product judgement (Stacks) and code
 * (GitHub) but nothing about production, so a PRD asserted that a problem was
 * worth solving rather than showing it. These three sources answer "is this
 * real, and how big" from data the platform already holds.
 *
 * Modelled on BugHunterFinderDataService, and for its stated reason: the
 * owning modules' own endpoints are `@RequireFeatureToggle`-gated for a
 * logged-in human, so an agent proxies through its own surface rather than
 * acquiring a second credential type.
 *
 * Every method fails soft, returning `{ok: false, error}` rather than
 * throwing. A research lookup must degrade the turn, never end it — and the
 * message has to say what went wrong, because a model told only "error"
 * concludes the source is empty and asserts that to the admin.
 */
@Injectable()
export class BuilderEvidenceService {
  private readonly logger = LoggerService.getInstance(
    BuilderEvidenceService.name,
  );

  constructor(
    private readonly analyticsAgent: AnalyticsAgentService,
    private readonly logsService: LogsService,
    private readonly bugFindingService: BugFindingService,
    private readonly uxSignalRead: UxSignalReadService,
  ) {}

  /**
   * Ask the Analytics Agent a question in English.
   *
   * Deadlined well under its own budget. It makes two ally-ai calls at up to
   * 120s each, which is longer than an interview turn should ever block — the
   * admin is sitting watching a cursor, and a slow answer is worse than an
   * honest "that took too long, ask me something narrower".
   */
  async analyticsAsk(question: string, userId: number): Promise<any> {
    const trimmed = String(question ?? '').trim();
    if (!trimmed) {
      return { ok: false, error: 'Ask a question first.' };
    }
    try {
      const answer = await this.withDeadline(
        this.analyticsAgent.ask({ question: trimmed } as any, userId),
        BUILDER_EVIDENCE_TIMEOUT_MS,
      );
      return {
        ok: true,
        outcome: answer.outcome,
        answer: answer.answer ?? null,
        // The SQL rides along so the agent can say how a number was derived.
        // A figure in a PRD that nobody can trace is worse than no figure.
        sql: answer.sql ?? null,
        rowCount: answer.rows?.length ?? 0,
        caveats: answer.caveats ?? [],
      };
    } catch (error) {
      return this.soft('analytics', error);
    }
  }

  /**
   * Error SHAPES from production, never raw lines.
   *
   * The AWS logs controller is SUPER_DUPER_ADMIN-gated because these lines
   * "can carry sensitive request data" — its words. An interview transcript is
   * durable, admin-facing and fed to a model, so raw lines must not reach it.
   * Grouping by signature is also simply more useful: "this throws 400 times a
   * day" is the fact a PRD needs, not four hundred copies of it.
   */
  async prodErrors(repo: string, search?: string): Promise<any> {
    if (!LOGGED_REPOS.includes(repo as AwsLogServiceKey)) {
      return {
        ok: true,
        repo,
        shapes: [],
        note: `${repo} has no server-side log group — only ${LOGGED_REPOS.join(', ')} do.`,
      };
    }
    const endTime = Date.now();
    const startTime =
      endTime - BUILDER_EVIDENCE_ERROR_WINDOW_HOURS * 60 * 60 * 1000;
    try {
      const { events } = await this.withDeadline(
        this.logsService.getLogEvents({
          service: repo as AwsLogServiceKey,
          startTime,
          endTime,
          level: 'ERROR',
          ...(search?.trim() ? { search: search.trim() } : {}),
        } as any),
        BUILDER_EVIDENCE_TIMEOUT_MS,
      );
      return {
        ok: true,
        repo,
        windowHours: BUILDER_EVIDENCE_ERROR_WINDOW_HOURS,
        shapes: this.toShapes(events ?? []),
      };
    } catch (error) {
      return this.soft('production logs', error);
    }
  }

  /** What Bug Hunter already knows is broken here. */
  async openFindings(repo?: string): Promise<any> {
    try {
      const findings = await this.withDeadline(
        this.bugFindingService.listOpenForRepo(repo?.trim() || undefined),
        BUILDER_EVIDENCE_TIMEOUT_MS,
      );
      return {
        ok: true,
        findings: findings.map((finding) => ({
          id: finding.id,
          repo: finding.repo,
          status: finding.status,
          title: finding.title,
          file: finding.file ?? null,
        })),
      };
    } catch (error) {
      return this.soft('bug findings', error);
    }
  }

  /**
   * What telemetry says people struggle with.
   *
   * The fourth source, and the only one that speaks for users rather than for
   * the system: analytics answers "how much", logs answer "what breaks",
   * findings answer "what we already know", and this answers "where people
   * got stuck and gave up". A PRD can now open with observed friction instead
   * of an assumed problem.
   *
   * The scan window rides along untouched. A caller that loses it will state
   * three-week-old friction in the present tense, and the interview's whole
   * value here is that the claim is checkable.
   */
  async uxSignals(query?: string): Promise<any> {
    try {
      const evidence = await this.withDeadline(
        this.uxSignalRead.frictionEvidence(query),
        BUILDER_EVIDENCE_TIMEOUT_MS,
      );
      return { ok: true, ...evidence };
    } catch (error) {
      return this.soft('UX signals', error);
    }
  }

  /**
   * Collapse log lines into counted signatures.
   *
   * Timestamps, uuids, numbers and quoted values are what make two instances
   * of one error look different, so they are masked before grouping. Crude,
   * and right for the question being asked: the agent wants to know what
   * breaks and how often, not to read a stack trace.
   */
  private toShapes(events: { message: string; timestamp: number }[]): {
    signature: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }[] {
    const groups = new Map<
      string,
      { count: number; first: number; last: number }
    >();
    for (const event of events) {
      const signature = String(event.message ?? '')
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>')
        .replace(/"[^"]*"/g, '"…"')
        .replace(/\b\d+\b/g, '<n>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
      if (!signature) continue;
      const existing = groups.get(signature);
      if (existing) {
        existing.count += 1;
        existing.first = Math.min(existing.first, event.timestamp);
        existing.last = Math.max(existing.last, event.timestamp);
      } else {
        groups.set(signature, {
          count: 1,
          first: event.timestamp,
          last: event.timestamp,
        });
      }
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, BUILDER_EVIDENCE_MAX_SHAPES)
      .map(([signature, g]) => ({
        signature,
        count: g.count,
        firstSeen: new Date(g.first).toISOString(),
        lastSeen: new Date(g.last).toISOString(),
      }));
  }

  private async withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)),
        ms,
      );
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private soft(source: string, error: unknown): Record<string, any> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Builder evidence lookup (${source}) failed: ${message}`);
    return {
      ok: false,
      error:
        `Could not reach ${source} (${message}). This is a lookup problem, ` +
        `not an answer — do not conclude the source holds nothing.`,
    };
  }
}
