import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { stripMarkdownFences } from 'src/learn/util/autofill-shared.util';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';

import { BugFinding } from '../entity/bug-finding.entity';
import {
  BUG_HUNTER_PROMPT_CODES,
  BUG_HUNTER_REVIEW_STUDY_MAX_CONCERNS,
  BUG_HUNTER_REVIEW_STUDY_MAX_TOKENS,
  BUG_HUNTER_REVIEW_STUDY_MODEL,
  BUG_HUNTER_REVIEW_STUDY_TASK_ID,
} from '../constants/bug-hunter.constants';
import { clipDossierText } from '../constants/bug-fix-dossier';
import {
  BugFixStudy,
  BugFixStudyReview,
  renderBugFixStudyLines,
  studyLeavesConsumersBehind,
  toBugFixStudy,
} from '../type/bug-fix-study.type';
import {
  BugFaultLocation,
  faultLocationOf,
  isDataFault,
} from '../type/bug-finding-verdict.type';

/**
 * Exported for the spec: the sentence that refuses a study which puts the
 * value in a layer the Verifier has already ruled out, or null when the two
 * agree (or no fault was located).
 */
export const studyContradictsFault = (
  study: Pick<BugFixStudy, 'valueLivesIn'>,
  fault: BugFaultLocation | null,
): string | null => {
  if (!fault || fault.layer === 'unknown') return null;
  const evidence = fault.evidence ? ` Its evidence: ${fault.evidence}` : '';
  if (isDataFault(fault)) {
    if (
      study.valueLivesIn === 'database' ||
      study.valueLivesIn === 'config' ||
      study.valueLivesIn === 'mixed' ||
      study.valueLivesIn === 'other_repo'
    ) {
      return null;
    }
    return (
      `The independent Verifier located this fault in production ${fault.layer}, not in code, and your study says the value lives in ${study.valueLivesIn}.${evidence}` +
      (fault.repair ? ` The repair it named: ${fault.repair}.` : '') +
      ` A code change cannot fix a missing or wrong ${fault.layer === 'data' ? 'row' : 'setting'}. Post the study again with valueLivesIn matching the Verifier, and if the fix is not code at all, stop and escalate with the repair instead of writing one.`
    );
  }
  if (fault.layer === 'code' && study.valueLivesIn !== 'code') {
    return `The independent Verifier located this fault in code${
      fault.repo ? ` in ${fault.repo}` : ''
    }, and your study says the value lives in ${
      study.valueLivesIn
    }.${evidence} Post the study again against the code path the Verifier named.`;
  }
  return null;
};

/**
 * Records the study a fix session writes before it touches code, and has a
 * second model read it — see `BugFixStudy` for why the step exists.
 *
 * The POST that carries the study is answered with the stored study, review
 * included, so the session reads the concerns in the same round trip and
 * answers them before it edits anything. The review is best-effort: a model
 * that is down or answers nonsense leaves `review.concerns` empty with a
 * warning, and the session proceeds on its own study. A study missing a
 * required field is refused with a 400 naming the fields, because a study
 * with no root cause or no test plan is the thing this step exists to stop.
 */
@Injectable()
export class BugFixStudyService {
  private readonly logger = LoggerService.getInstance(BugFixStudyService.name);

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
    @InjectRepository(BugFinding)
    private readonly findingRepository: Repository<BugFinding>,
  ) {}

  /** Validate, review, store on the finding; returns what was stored. */
  async record(
    finding: BugFinding,
    runId: string | null,
    raw: Record<string, unknown> | null | undefined,
  ): Promise<BugFixStudy> {
    const parsed = toBugFixStudy(raw, { runId });
    if (!parsed.study) {
      throw new BadRequestException(
        `The study is missing: ${parsed.missing.join('; ')}. Post it again with every required field.`,
      );
    }
    // The Verifier already located the fault in production; a study that
    // puts the value somewhere else is the wrong-layer fix about to happen.
    const fault = faultLocationOf(finding.metadata);
    const contradiction = studyContradictsFault(parsed.study, fault);
    if (contradiction) {
      throw new BadRequestException(contradiction);
    }
    // A step of a cross-repo plan has its other halves in sibling steps.
    if (!finding.parentFindingId) {
      const leftBehind = studyLeavesConsumersBehind(
        parsed.study,
        finding.repo ?? '',
      );
      if (leftBehind) throw new BadRequestException(leftBehind);
    }
    const review = await this.review(finding, parsed.study);
    const study: BugFixStudy = { ...parsed.study, review };
    await this.findingRepository.update(finding.id, {
      metadata: {
        ...(finding.metadata ?? {}),
        study,
      } as Record<string, any>,
    });
    return study;
  }

  /** The model call alone — exposed for the spec. Never throws. */
  async review(
    finding: Pick<BugFinding, 'title' | 'description' | 'repo' | 'file'>,
    study: BugFixStudy,
  ): Promise<BugFixStudyReview> {
    const at = new Date().toISOString();
    const empty: BugFixStudyReview = {
      concerns: [],
      model: BUG_HUNTER_REVIEW_STUDY_MODEL,
      at,
    };
    try {
      const template = await this.promptSharedService.getPromptByCode(
        toPromptCode('bug_hunter', 'review_study'),
      );
      if (!template) {
        this.logger.warn(
          `[BUG_HUNTER] Prompt template not found: ${BUG_HUNTER_PROMPT_CODES.REVIEW_STUDY}; study not reviewed.`,
        );
        return { ...empty, model: null };
      }
      const userMessage = [
        `Bug in ${finding.repo ?? 'an unknown repo'}${finding.file ? `, filed against ${finding.file}` : ''}:`,
        `"""`,
        `${finding.title}`,
        clipDossierText(finding.description, 4000),
        `"""`,
        ``,
        `The session's study:`,
        ...renderBugFixStudyLines({ ...study, review: null }),
      ].join('\n');

      const response = await this.llmCompletion.complete({
        taskId: BUG_HUNTER_REVIEW_STUDY_TASK_ID,
        task: LlmTask.BUG_HUNTER,
        model: BUG_HUNTER_REVIEW_STUDY_MODEL,
        system: template,
        prompt: userMessage,
        maxTokens: BUG_HUNTER_REVIEW_STUDY_MAX_TOKENS,
        jsonMode: true,
        usageMetadata: { feature: 'bug-hunter', label: 'review-study' },
      });
      const cleaned = stripMarkdownFences(response.text ?? '');
      let parsed: any = null;
      for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0]]) {
        if (!candidate) continue;
        try {
          parsed = JSON.parse(candidate);
          break;
        } catch {
          // try the next candidate
        }
      }
      const concerns = Array.isArray(parsed?.concerns)
        ? parsed.concerns
            .filter((c: unknown) => typeof c === 'string' && c.trim())
            .map((c: string) => clipDossierText(c, 400))
            .slice(0, BUG_HUNTER_REVIEW_STUDY_MAX_CONCERNS)
        : null;
      if (!concerns) {
        this.logger.warn(
          `[BUG_HUNTER] review-study: model output was not {concerns: [...]}: ${cleaned.slice(0, 200)}`,
        );
        return empty;
      }
      return { ...empty, concerns };
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Study review failed; the session proceeds on its own study: ${(error as Error)?.message}`,
      );
      return empty;
    }
  }
}
