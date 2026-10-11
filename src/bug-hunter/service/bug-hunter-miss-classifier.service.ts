import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Not, Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { stripMarkdownFences } from 'src/learn/util/autofill-shared.util';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugFindingSource } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import {
  BUG_HUNTER_CLASSIFY_MISS_LOOKBACK_DAYS,
  BUG_HUNTER_CLASSIFY_MISS_MAX_CONTEXT_FINDINGS,
  BUG_HUNTER_CLASSIFY_MISS_MAX_TOKENS,
  BUG_HUNTER_CLASSIFY_MISS_MODEL,
  BUG_HUNTER_CLASSIFY_MISS_TASK_ID,
  BUG_HUNTER_PROMPT_CODES,
} from '../constants/bug-hunter.constants';
import {
  BugFindingMiss,
  toBugFindingMiss,
} from '../type/bug-finding-miss.type';

/**
 * Writes the miss record on a human-reported bug — see
 * `BugFindingMiss` for what the record is and why it exists.
 *
 * Runs at intake (RoadmapOpportunityService.create) and again when an admin
 * rewrites the description (BugFindingService.editDescription). Always
 * best-effort and never awaited by the request that triggered it: a report
 * must be filed whether or not the model answers, and the record can be
 * written a few seconds after the row.
 *
 * Same guardrail as the repo classifier: an answer is only stored when it
 * validates against the reason and sense catalogues, and a `detected_*`
 * answer only keeps its matched finding id when that id is one of the
 * findings the model was actually shown.
 */
@Injectable()
export class BugHunterMissClassifierService {
  private readonly logger = LoggerService.getInstance(
    BugHunterMissClassifierService.name,
  );

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
    @InjectRepository(BugFinding)
    private readonly findingRepository: Repository<BugFinding>,
    @InjectRepository(BugHuntEvent)
    private readonly eventRepository: Repository<BugHuntEvent>,
  ) {}

  /**
   * Classify and store, swallowing every failure into a warning. Returns the
   * record that was written, or null.
   */
  async classifyAndRecord(
    findingId: string,
    trigger: 'intake' | 'description_edited' = 'intake',
  ): Promise<BugFindingMiss | null> {
    try {
      const finding = await this.findingRepository.findOne({
        where: { id: findingId },
      });
      if (!finding) {
        throw new NotFoundException(`Bug finding ${findingId} not found`);
      }
      if (finding.source !== BugFindingSource.REPORTED_BUG) return null;

      const context = await this.recentOwnFindings(finding);
      const miss = await this.classify(finding, context);
      if (!miss) return null;

      await this.findingRepository.update(finding.id, {
        metadata: {
          ...(finding.metadata ?? {}),
          miss,
        } as Record<string, any>,
      });
      await this.eventRepository.save(
        this.eventRepository.create({
          runId: null,
          repo: finding.repo ?? null,
          stage: BugHuntEventStage.FINDER_RESULT,
          findingId: finding.id,
          summary: this.summaryFor(miss),
          payload: { miss, trigger },
        }),
      );
      return miss;
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Miss classification for finding ${findingId} failed, leaving it unrecorded: ${
          (error as Error)?.message
        }`,
      );
      return null;
    }
  }

  /** The model call alone — exposed for the spec and for a future replay. */
  async classify(
    finding: Pick<
      BugFinding,
      'id' | 'repo' | 'title' | 'description' | 'createdAt'
    >,
    context: Pick<
      BugFinding,
      | 'id'
      | 'repo'
      | 'source'
      | 'status'
      | 'title'
      | 'decisionReason'
      | 'createdAt'
    >[],
  ): Promise<BugFindingMiss | null> {
    const template = await this.promptSharedService.getPromptByCode(
      toPromptCode('bug_hunter', 'classify_miss'),
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found: ${BUG_HUNTER_PROMPT_CODES.CLASSIFY_MISS}`,
      );
    }

    const contextLines = context.length
      ? context
          .map(
            (c) =>
              `- id=${c.id} | ${toDate(c.createdAt)} | ${c.source} | ${c.status}` +
              `${c.decisionReason ? ` (${c.decisionReason})` : ''} | ${c.title}`,
          )
          .join('\n')
      : '(no findings from my own senses on this repo in the window)';

    const userMessage =
      `Reported bug (filed ${toDate(finding.createdAt)}, repo: ${finding.repo ?? 'unknown'}):\n` +
      `"""\n${finding.description}\n"""\n\n` +
      `My own findings on ${finding.repo ?? 'all repos'} in the last ${BUG_HUNTER_CLASSIFY_MISS_LOOKBACK_DAYS} days:\n` +
      contextLines;

    let raw: string | null;
    try {
      const response = await this.llmCompletion.complete({
        taskId: BUG_HUNTER_CLASSIFY_MISS_TASK_ID,
        task: LlmTask.BUG_HUNTER,
        model: BUG_HUNTER_CLASSIFY_MISS_MODEL,
        system: template,
        prompt: userMessage,
        maxTokens: BUG_HUNTER_CLASSIFY_MISS_MAX_TOKENS,
        jsonMode: true,
        usageMetadata: { feature: 'bug-hunter', label: 'classify-miss' },
      });
      raw = response.text || null;
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Miss classification call failed: ${(error as Error)?.message}`,
      );
      return null;
    }
    if (!raw) return null;

    const cleaned = stripMarkdownFences(raw);
    let parsed: Record<string, unknown> | null = null;
    for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0]]) {
      if (!candidate) continue;
      try {
        parsed = JSON.parse(candidate);
        break;
      } catch {
        // try the next candidate
      }
    }
    if (!parsed) {
      this.logger.warn(
        `[BUG_HUNTER] classify-miss: model output was not parseable JSON: ${cleaned.slice(0, 200)}`,
      );
      return null;
    }

    const miss = toBugFindingMiss(parsed, BUG_HUNTER_CLASSIFY_MISS_MODEL);
    if (!miss) {
      this.logger.warn(
        `[BUG_HUNTER] classify-miss: discarding an answer that does not fit the catalogue: ${cleaned.slice(0, 200)}`,
      );
      return null;
    }
    // Only a finding the model was shown can be "the one it matched".
    if (
      miss.matchedFindingId &&
      !context.some((c) => c.id === miss.matchedFindingId)
    ) {
      miss.matchedFindingId = null;
    }
    return miss;
  }

  private async recentOwnFindings(finding: BugFinding) {
    const since = new Date(
      Date.now() - BUG_HUNTER_CLASSIFY_MISS_LOOKBACK_DAYS * 86_400_000,
    );
    return this.findingRepository.find({
      where: {
        ...(finding.repo ? { repo: finding.repo } : {}),
        source: Not(BugFindingSource.REPORTED_BUG),
        createdAt: MoreThanOrEqual(since),
      },
      order: { createdAt: 'DESC' },
      take: BUG_HUNTER_CLASSIFY_MISS_MAX_CONTEXT_FINDINGS,
      select: [
        'id',
        'repo',
        'source',
        'status',
        'title',
        'decisionReason',
        'createdAt',
      ],
    });
  }

  private summaryFor(miss: BugFindingMiss): string {
    const why: Record<BugFindingMiss['reason'], string> = {
      no_sense: `I had no sense that could have seen this; it would need ${miss.sense}.`,
      sense_missed: `My ${miss.sense} sense covers this kind of bug and did not flag it.`,
      detected_declined: `My ${miss.sense} sense had flagged this and a person declined it.`,
      detected_not_fixed: `My ${miss.sense} sense had flagged this and it was not yet fixed or released.`,
      not_a_miss: 'Not a miss on my part.',
    };
    return `Why I did not find this first: ${why[miss.reason]}${
      miss.rationale ? ` ${miss.rationale}` : ''
    }`;
  }
}

function toDate(d: Date | string | null | undefined): string {
  if (!d) return 'unknown date';
  const iso = d instanceof Date ? d.toISOString() : String(d);
  return iso.slice(0, 10);
}
