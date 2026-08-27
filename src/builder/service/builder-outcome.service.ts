import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderExemplarService } from './builder-exemplar.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderLessonCuratorService } from './builder-lesson-curator.service';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderLessonRepository } from '../repository/builder-knowledge.repository';
import {
  BuilderPrFeedbackRepository,
  BuilderPullRequestRepository,
  BuilderReportRepository,
} from '../repository/builder-build.repository';
import {
  BuilderExemplarOutcome,
  BuilderFailureTag,
  BuilderLessonCategory,
  BuilderPrFeedbackKind,
} from '../enum/builder.enum';
import { BUILDER_MAX_TOKENS } from '../constants/builder.constants';

/**
 * The feedback half of the flywheel: turn what happened to a build into
 * something the next build reads.
 *
 * Three signals, none of which Builder previously used:
 *
 *  - **Merge outcomes.** A merged PR and one closed without merging looked
 *    identical, so nothing could tell good work from rejected work.
 *  - **Review comments.** The single highest-value source in the system —
 *    a person spent attention explaining precisely what was wrong with the
 *    code — and it evaporated into GitHub with nothing reading it.
 *  - **Fix runs and CI failures.** How much correction the work needed after
 *    it was called finished.
 *
 * Each becomes a categorised outcome (so trends exist across builds rather
 * than a story per build) plus candidate lessons for the curator, and updates
 * the counters that decide which lessons keep earning their place.
 */
@Injectable()
export class BuilderOutcomeService {
  private readonly logger = LoggerService.getInstance(
    BuilderOutcomeService.name,
  );

  // Exposed for tests (mocked with a fake client), matching the orchestrator.
  protected client: Anthropic;

  constructor(
    private readonly configService: AppConfigService,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly feedbackRepository: BuilderPrFeedbackRepository,
    private readonly reportRepository: BuilderReportRepository,
    private readonly lessonRepository: BuilderLessonRepository,
    private readonly exemplarService: BuilderExemplarService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly curatorService: BuilderLessonCuratorService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

  /**
   * The hourly catch-up.
   *
   * Hooks on merge and settle do most of the work; this exists because a hook
   * that fails, or a PR merged while the service was down, would otherwise
   * leave an exemplar permanently stale. Idempotent by `lastOutcomeSyncAt`.
   */
  async sweep(): Promise<{ refreshed: number }> {
    const unsettled = await this.exemplarService.listUnsettled();
    let refreshed = 0;

    for (const exemplar of unsettled) {
      try {
        await this.processSession(exemplar.sessionId);
        refreshed += 1;
      } catch (error) {
        this.logger.warn(
          `Outcome sweep failed for session ${exemplar.sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Fold anything the sweep harvested into the curated set while we are here.
    await this.curatorService.consolidate().catch(() => undefined);
    return { refreshed };
  }

  /**
   * Learn from one session: refresh its exemplar, categorise how it went, and
   * harvest candidate lessons from the feedback it collected.
   */
  async processSession(sessionId: string): Promise<void> {
    await this.exemplarService.refreshOutcome(sessionId);

    const exemplar = await this.exemplarService.findBySession(sessionId);
    if (!exemplar) return;

    // Nothing to categorise on a build that went cleanly: merged, no fix runs,
    // no comments. Saying so costs a model call and teaches nobody anything.
    const feedback = await this.feedbackRepository.listBySession(sessionId);
    const settled = exemplar.outcome !== BuilderExemplarOutcome.OPEN;
    const wentCleanly =
      exemplar.outcome === BuilderExemplarOutcome.MERGED &&
      !exemplar.fixRunCount &&
      !feedback.length;
    if (!settled || wentCleanly) return;

    const already = new Set(exemplar.failureTags ?? []);
    const analysis = await this.categorise(sessionId, exemplar, feedback);
    if (!analysis) return;

    const freshTags = analysis.tags.filter((tag) => !already.has(tag));
    if (freshTags.length) {
      await this.exemplarService.recordFailureTags(sessionId, freshTags);
    }

    // Candidate lessons, not active ones: the curator decides whether each is
    // new, a duplicate of something already known, or not worth a slot.
    for (const lesson of analysis.lessons.slice(0, 3)) {
      await this.knowledgeService.recordLesson({
        sessionId,
        repos: exemplar.repos ?? null,
        category: lesson.category,
        lesson: lesson.text,
      });
    }

    await this.applyLessonOutcomes(sessionId, exemplar.outcome, analysis);

    if (analysis.lessons.length || freshTags.length) {
      this.logger.info(
        `Session ${sessionId} (${exemplar.outcome}) produced ${analysis.lessons.length} candidate lesson(s) and ${freshTags.length} new tag(s).`,
      );
    }
  }

  /**
   * Promote or demote the lessons this run was given.
   *
   * A lesson a merged build cited earns credit; a lesson that was in front of
   * the agent and did not prevent the thing it warns about earns a mark
   * against it. This is what makes the curator's retirement decisions evidence
   * rather than taste — and it is why runs are asked to report
   * `appliedLessonIds` at all.
   */
  private async applyLessonOutcomes(
    sessionId: string,
    outcome: BuilderExemplarOutcome,
    analysis: OutcomeAnalysis,
  ): Promise<void> {
    const reports = await this.reportRepository.listBySession(sessionId);
    const applied = new Set<string>();
    for (const report of reports) {
      const ids = report.metrics?.appliedLessonIds;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) applied.add(String(id));
    }

    const merged =
      outcome === BuilderExemplarOutcome.MERGED ||
      outcome === BuilderExemplarOutcome.PARTIALLY_MERGED;
    if (merged && applied.size) {
      // Credit only on a merge: a lesson cited by work nobody accepted has not
      // been shown to have helped.
      await this.lessonRepository.recordApplied([...applied]);
    }

    if (analysis.contradictedLessonIds.length) {
      await this.lessonRepository.recordContradicted(
        analysis.contradictedLessonIds,
      );
    }
  }

  /**
   * One cheap model call to categorise the outcome and draft candidate
   * lessons.
   *
   * A model rather than rules because the input is prose written by people —
   * "this needs a null check for a deleted tenant" has to become
   * `review_correctness` plus a reusable lesson, and no keyword table does
   * that. Returns null rather than throwing: the flywheel losing one build's
   * analysis is a missed improvement, not a failure.
   */
  private async categorise(
    sessionId: string,
    exemplar: { outcome: string; title: string; repos?: string[] | null },
    feedback: {
      kind: BuilderPrFeedbackKind;
      author?: string | null;
      body?: string | null;
      path?: string | null;
    }[],
  ): Promise<OutcomeAnalysis | null> {
    const model = this.configService.builder.mechanicalModel;
    const activeLessons = await this.lessonRepository.listActiveForRepos(
      exemplar.repos ?? undefined,
    );

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: BUILDER_MAX_TOKENS,
        system: OUTCOME_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              `## The build\n${exemplar.title} (${exemplar.repos?.join(', ') ?? 'unknown repos'})`,
              `Outcome: ${exemplar.outcome}`,
              '',
              '## What people and CI said',
              feedback.length
                ? feedback
                    .map(
                      (item) =>
                        `- (${item.kind}${item.path ? `, ${item.path}` : ''}) ${
                          item.body ?? ''
                        }`,
                    )
                    .join('\n')
                : '(nothing recorded)',
              '',
              '## Lessons this build already had access to',
              activeLessons.length
                ? activeLessons
                    .map((lesson) => `- [${lesson.id}] ${lesson.lesson}`)
                    .join('\n')
                : '(none)',
              '',
              'Return the JSON object and nothing else.',
            ].join('\n'),
          },
        ],
      });

      const input = response.usage?.input_tokens ?? 0;
      const output = response.usage?.output_tokens ?? 0;
      void this.llmUsage.record({
        provider: 'anthropic',
        model,
        task: LlmTask.BUILDER_OUTCOME_CATEGORISE,
        promptTokens: input,
        completionTokens: output,
        totalTokens: input + output,
        metadata: { builderSessionId: sessionId, feedback: feedback.length },
      });

      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
      return parseAnalysis(text, new Set(activeLessons.map((l) => l.id)));
    } catch (error) {
      this.logger.warn(
        `Could not categorise session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

interface OutcomeAnalysis {
  tags: BuilderFailureTag[];
  lessons: { category: BuilderLessonCategory; text: string }[];
  contradictedLessonIds: string[];
}

const TAGS = new Set<string>(Object.values(BuilderFailureTag));
const CATEGORIES = new Set<string>(Object.values(BuilderLessonCategory));

/**
 * Parse the analysis, keeping only values we recognise.
 *
 * `contradictedLessonIds` in particular is filtered against the ids actually
 * offered: an invented id would silently penalise nothing, or worse, the wrong
 * lesson.
 */
export function parseAnalysis(
  text: string,
  knownLessonIds: Set<string>,
): OutcomeAnalysis | null {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
  for (const raw of [...blocks, text]) {
    const start = raw.indexOf('{');
    if (start === -1) continue;
    try {
      const parsed = JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1));
      return {
        tags: (Array.isArray(parsed.tags) ? parsed.tags : [])
          .map((tag: unknown) => String(tag))
          .filter((tag: string) => TAGS.has(tag)) as BuilderFailureTag[],
        lessons: (Array.isArray(parsed.lessons) ? parsed.lessons : [])
          .map((entry: any) => ({
            category: CATEGORIES.has(String(entry?.category))
              ? (String(entry.category) as BuilderLessonCategory)
              : BuilderLessonCategory.GOTCHA,
            text: String(entry?.lesson ?? entry?.text ?? '').trim(),
          }))
          .filter((entry: { text: string }) => entry.text.length > 10),
        contradictedLessonIds: (Array.isArray(parsed.contradictedLessonIds)
          ? parsed.contradictedLessonIds
          : []
        )
          .map((id: unknown) => String(id))
          .filter((id: string) => knownLessonIds.has(id)),
      };
    } catch {
      continue;
    }
  }
  return null;
}

const OUTCOME_SYSTEM_PROMPT = `
You read what happened to a finished software change after it was submitted —
whether it was merged, what CI said, what reviewers said — and turn it into
structured signal for the agent that will attempt the next one.

Three outputs:

**1. \`tags\`** — why this needed rework, from exactly this list:
test_failure, type_error, lint, migration_conflict, ci_infra, build_timeout,
budget_exceeded, runner_lost, review_correctness, review_scope_creep,
review_style, review_missing_tests, closed_abandoned, other.

Tag what the evidence shows, not what you suspect. A clean merge earns no tags.

**2. \`lessons\`** — at most three, and only ones that would genuinely change
how the next build is done. A review comment is the best possible source: a
person spent their attention explaining exactly what was wrong.

A lesson must be:
- **reusable** — about the platform, not this one change. "The digest query
  needs a tenant guard" is not reusable; "queries in ally-be must filter by
  tenantId or they leak across orgs" is.
- **specific enough to check** — name the repo, file, command or symptom.
- **written for a stranger** who has never seen this build.

Write nothing rather than something vague. "Be more careful" costs a slot in a
capped set and teaches nobody anything.

**3. \`contradictedLessonIds\`** — lessons the build already had in front of it
that did not prevent the problem anyway, either because the agent ignored one
or because it is worded too weakly to act on. Only ids from the list given.
This is how a lesson that does not work gets retired, so be honest: a lesson
that was irrelevant to what went wrong is NOT contradicted.

Output shape:

\`\`\`json
{
  "tags": ["review_correctness"],
  "lessons": [
    {"category": "gotcha|convention|estimate|process", "lesson": "…"}
  ],
  "contradictedLessonIds": []
}
\`\`\`
`.trim();
