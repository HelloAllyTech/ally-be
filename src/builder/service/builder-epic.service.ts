import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderMilestone } from '../entity/builder-milestone.entity';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderMilestoneStatus } from '../enum/builder.enum';
import {
  BUILDER_MAX_TOKENS,
  BUILDER_MILESTONES_MAX,
  BUILDER_MILESTONES_MIN,
} from '../constants/builder.constants';

/**
 * Epic mode: cut a large PRD into slices that each ship on their own.
 *
 * A PRD big enough to be worth Builder's time is often too big for one run —
 * a two-hour runner ceiling, a finite context, and a pull request nobody wants
 * to review in one sitting. Milestones make each slice its own reviewable PR,
 * built in order, each branching from the last so slice 2 can build on slice 1
 * before anyone has merged it.
 *
 * The decomposition is a strong-model call because it is a judgement about
 * shippability, not a partition: "which of these requirements form something
 * that works on its own" is exactly the question a weaker model answers by
 * counting.
 *
 * **The admin confirms the split before anything dispatches.** A wrong
 * decomposition is expensive in a way a wrong plan is not: it becomes three
 * pull requests in the wrong shape, and the cheapest moment to fix it is
 * before the first one exists.
 */
@Injectable()
export class BuilderEpicService {
  private readonly logger = LoggerService.getInstance(BuilderEpicService.name);

  // Exposed for tests (mocked with a fake client), matching the orchestrator.
  protected client: Anthropic;
  private readonly repository: Repository<BuilderMilestone>;

  constructor(
    private readonly configService: AppConfigService,
    dataSource: DataSource,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.repository = dataSource.getRepository(BuilderMilestone);
  }

  listBySession(sessionId: string): Promise<BuilderMilestone[]> {
    return this.repository.find({
      where: { sessionId },
      order: { position: 'ASC' },
    });
  }

  /**
   * Propose a split. Stored as PENDING rows for the admin to confirm; calling
   * again replaces an unconfirmed proposal, so a bad one can simply be redone.
   */
  async propose(
    session: BuilderSession,
    prd: BuilderPrdDocument,
  ): Promise<BuilderMilestone[]> {
    const existing = await this.listBySession(session.id);
    if (existing.some((m) => m.status !== BuilderMilestoneStatus.PENDING)) {
      throw new BadRequestException(
        'This session has already started building its milestones, so the split cannot be redrawn.',
      );
    }

    const requirements = prd.requirements ?? [];
    if (requirements.length < 2) {
      throw new BadRequestException(
        'A PRD with fewer than two requirements is one milestone — build it directly.',
      );
    }

    const proposal = await this.ask(prd);
    const slices = this.validate(proposal, requirements);

    // Replace wholesale rather than reconciling: an unconfirmed proposal has
    // no history worth preserving, and a partial overwrite could leave a
    // requirement assigned to a milestone that no longer exists.
    if (existing.length) {
      await this.repository.delete({ sessionId: session.id });
    }

    const saved = await this.repository.save(
      slices.map((slice, index) =>
        this.repository.create({
          sessionId: session.id,
          position: index + 1,
          title: slice.title,
          summaryMd: slice.summaryMd,
          requirementIds: slice.requirementIds,
          technicalNotesMd: slice.technicalNotesMd,
          status: BuilderMilestoneStatus.PENDING,
          branchSlug: `${session.slug}-m${index + 1}`,
        }),
      ),
    );
    this.logger.info(
      `Builder session ${session.id} proposed ${saved.length} milestone(s).`,
    );
    return saved.sort((a, b) => a.position - b.position);
  }

  /** The next milestone to build, or null when the epic is done. */
  async nextPending(sessionId: string): Promise<BuilderMilestone | null> {
    const milestones = await this.listBySession(sessionId);
    return (
      milestones.find(
        (milestone) => milestone.status === BuilderMilestoneStatus.PENDING,
      ) ?? null
    );
  }

  /** Milestones already built, for the next one's prompt to build on. */
  async completedBefore(
    sessionId: string,
    position: number,
  ): Promise<BuilderMilestone[]> {
    const milestones = await this.listBySession(sessionId);
    return milestones.filter(
      (milestone) =>
        milestone.position < position &&
        milestone.status === BuilderMilestoneStatus.COMPLETED,
    );
  }

  async markStatus(
    milestoneId: string,
    status: BuilderMilestoneStatus,
    error?: string | null,
  ): Promise<void> {
    await this.repository.update(
      { id: milestoneId },
      {
        status,
        ...(status === BuilderMilestoneStatus.BUILDING
          ? { startedAt: new Date() }
          : {}),
        ...(status === BuilderMilestoneStatus.COMPLETED ||
        status === BuilderMilestoneStatus.FAILED
          ? { completedAt: new Date() }
          : {}),
        ...(error !== undefined ? { error } : {}),
      },
    );
  }

  private async ask(prd: BuilderPrdDocument): Promise<ProposedMilestone[]> {
    const model = this.configService.builder.plannerModel;
    const requirements = (prd.requirements ?? [])
      .map(
        (requirement) =>
          `- **${requirement.id}** ${requirement.title}: ${requirement.description}`,
      )
      .join('\n');

    const response = await this.client.messages.create({
      model,
      max_tokens: BUILDER_MAX_TOKENS,
      system: EPIC_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            `# ${prd.title}`,
            '',
            `## Summary\n${prd.summary ?? ''}`,
            `## Problem\n${prd.problem ?? ''}`,
            '',
            '## Requirements',
            requirements,
            '',
            '## Technical plan',
            (prd.technicalPlan?.repos ?? [])
              .map((plan) => `### ${plan.repo}\n${plan.changesMd}`)
              .join('\n\n'),
            '',
            `Split this into between ${BUILDER_MILESTONES_MIN} and ${BUILDER_MILESTONES_MAX} milestones. Return the JSON array only.`,
          ].join('\n'),
        },
      ],
    });

    const input = response.usage?.input_tokens ?? 0;
    const output = response.usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
      model,
      task: LlmTask.BUILDER_EPIC_DECOMPOSITION,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      metadata: { requirements: (prd.requirements ?? []).length },
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    return parseMilestones(text);
  }

  /**
   * Every requirement assigned exactly once, and nothing invented.
   *
   * Checked in code because both failure modes are silent. A requirement in two
   * milestones gets built twice, and the second build finds the work already
   * done and either duplicates it or gets confused; a requirement in none is
   * simply dropped, and nobody notices until the feature is short a piece.
   */
  private validate(
    proposal: ProposedMilestone[],
    requirements: { id: string }[],
  ): ProposedMilestone[] {
    if (!proposal.length) {
      throw new BadRequestException(
        'The decomposition came back empty. Build the PRD as one milestone instead.',
      );
    }
    if (proposal.length > BUILDER_MILESTONES_MAX) {
      throw new BadRequestException(
        `The decomposition proposed ${proposal.length} milestones, past the limit of ${BUILDER_MILESTONES_MAX}.`,
      );
    }

    const known = new Set(requirements.map((requirement) => requirement.id));
    const seen = new Map<string, number>();

    for (const [index, slice] of proposal.entries()) {
      for (const id of slice.requirementIds) {
        if (!known.has(id)) {
          throw new BadRequestException(
            `The decomposition referenced requirement "${id}", which is not in the PRD.`,
          );
        }
        if (seen.has(id)) {
          throw new BadRequestException(
            `Requirement ${id} was assigned to more than one milestone (${
              seen.get(id)! + 1
            } and ${index + 1}).`,
          );
        }
        seen.set(id, index);
      }
    }

    const missing = [...known].filter((id) => !seen.has(id));
    if (missing.length) {
      throw new BadRequestException(
        `The decomposition left ${missing.length} requirement(s) unassigned: ${missing.join(', ')}.`,
      );
    }
    return proposal;
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

interface ProposedMilestone {
  title: string;
  summaryMd: string;
  requirementIds: string[];
  technicalNotesMd: string;
}

export function parseMilestones(text: string): ProposedMilestone[] {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
  for (const raw of [...blocks, text]) {
    const start = raw.indexOf('[');
    if (start === -1) continue;
    try {
      const parsed = JSON.parse(raw.slice(start, raw.lastIndexOf(']') + 1));
      if (!Array.isArray(parsed)) continue;
      return parsed
        .map((entry: any) => ({
          title: String(entry?.title ?? '')
            .slice(0, 200)
            .trim(),
          summaryMd: String(entry?.summary ?? entry?.summaryMd ?? '').trim(),
          requirementIds: Array.isArray(entry?.requirementIds)
            ? entry.requirementIds.map((id: unknown) => String(id))
            : [],
          technicalNotesMd: String(
            entry?.technicalNotes ?? entry?.technicalNotesMd ?? '',
          ).trim(),
        }))
        .filter((slice) => slice.title && slice.requirementIds.length);
    } catch {
      continue;
    }
  }
  return [];
}

const EPIC_SYSTEM_PROMPT = `
You split a large product requirements document into an ordered series of
milestones, each of which a coding agent will build and open as its own pull
request.

The test of a good milestone is simple: **could this be merged on its own and
leave the platform in a working, coherent state?** Not "is it a tidy group of
requirements" — mergeable on its own. A milestone that leaves a half-wired
feature behind is worse than no split at all, because someone has to review it
anyway and cannot tell whether it works.

Rules:

- **Every requirement goes in exactly one milestone.** Not two, not none. This
  is checked, and a violation is rejected.
- **Order matters and is strictly sequential.** Milestone 2 is built on top of
  milestone 1's branch, so it may rely on 1's code — but nothing may rely on a
  later milestone.
- **Foundations first.** A migration, a new table, a shared type or an API
  contract belongs in the milestone before whatever consumes it, not beside it.
- **Prefer few, substantial milestones.** Two or three that each do something
  is better than six that each do a fragment. If the PRD genuinely is one
  coherent change, say so with a single milestone.
- Each milestone gets a title a reviewer would recognise on a pull request,
  a summary of what it delivers, and technical notes for anything specific to
  building *this* slice — what it may assume already exists from the earlier
  ones, and what it must not touch yet.

Output a JSON array, in build order, and nothing else:

\`\`\`json
[
  {
    "title": "Store per-simulation comfort-audio settings",
    "summary": "The column, the migration and the service read path. Nothing user-facing yet.",
    "requirementIds": ["R1", "R2"],
    "technicalNotes": "Migration plus the service; the admin form comes in milestone 2 and will read this."
  }
]
\`\`\`
`.trim();
