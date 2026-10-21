import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { parseFirstJsonObject } from 'src/learn/util/autofill-shared.util';
import { BuilderEvalFixture } from '../../entity/builder-eval-fixture.entity';
import { BuilderMessage } from '../../entity/builder-message.entity';
import {
  BuilderMessageRole,
  BuilderPrdVersionAuthor,
  BuilderSessionStatus,
} from '../../enum/builder.enum';
import { CreateBuilderMessageDto } from '../../dto/builder.dto';
import {
  BuilderPrdDocument,
  BuilderPrdReadiness,
} from '../../type/builder-prd.type';
import { BUILDER_AI_TASKS } from '../../constants/builder.constants';
import { renderTranscriptForReview } from '../../service/builder-prd-review.service';
import {
  BuilderEvalSandbox,
  BuilderEvalSandboxFactory,
} from '../sandbox/builder-eval-sandbox.factory';
import {
  BUILDER_EVAL_ADMIN_SYSTEM_PROMPT,
  BUILDER_EVAL_JUDGE_SYSTEM_PROMPT,
  BUILDER_EVAL_MAX_TURNS,
} from '../constants/builder-eval-prompts';
import {
  BuilderEvalChecklistItem,
  BuilderEvalCriticOutcome,
  BuilderEvalGates,
  BuilderEvalInterviewPayload,
  BuilderEvalJudgement,
  BuilderEvalMetrics,
  BuilderEvalOverrides,
  BuilderEvalPrdReviewPayload,
  BuilderEvalRunStatus,
  BuilderEvalTurnRecord,
} from '../type/builder-eval.type';
import {
  computeEvalGates,
  gateViolations,
} from '../util/builder-eval-scoring.util';
import {
  BuilderBriefLine,
  BuilderSituationBrief,
  storedSituationBrief,
} from '../../util/builder-situation-brief.util';
import { BUILDER_TERMINAL_TOOLS } from '../../util/builder-turn-receipt.util';

const ADMIN_MAX_TOKENS = 4_000;
const JUDGE_MAX_TOKENS = 8_000;
const ADMIN_TRANSCRIPT_BUDGET = 30_000;
const PRD_FOR_PROMPT_MAX_CHARS = 24_000;

/** What one replay produced. The suite service stores it on the run row. */
export interface BuilderEvalRunResult {
  status: BuilderEvalRunStatus;
  gates: BuilderEvalGates | null;
  metrics: BuilderEvalMetrics | null;
  judge: BuilderEvalJudgement | null;
  critic: BuilderEvalCriticOutcome | null;
  transcript: BuilderEvalTurnRecord[] | null;
  finalPrd: BuilderPrdDocument | null;
  error: string | null;
}

/** What the simulated admin said, parsed. */
export interface SimulatedAdminReply {
  message: string;
  optionIds: string[];
  correction: boolean;
  about: string[];
  done: boolean;
  /** Verdicts on a situation brief's lines, when one was shown. */
  lines?: { id: string; verdict: 'confirm' | 'correct'; correction?: string }[];
}

const stripFence = (text: string) =>
  String(text ?? '')
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```\s*$/, '');

export function parseAdminReply(text: string): SimulatedAdminReply | null {
  const parsed = parseFirstJsonObject(stripFence(text));
  if (!parsed || typeof parsed !== 'object') return null;
  const message = String(parsed.message ?? '').trim();
  const done = parsed.done === true;
  if (!message && !done) return null;
  const lines = Array.isArray(parsed.lines)
    ? parsed.lines
        .map((line: any) => {
          const id = String(line?.id ?? '').trim();
          const correctionText = String(line?.correction ?? '').trim();
          return line?.verdict === 'correct' && correctionText
            ? { id, verdict: 'correct' as const, correction: correctionText }
            : { id, verdict: 'confirm' as const };
        })
        .filter((line: { id: string }) => line.id)
    : undefined;
  return {
    message,
    optionIds: Array.isArray(parsed.optionIds)
      ? parsed.optionIds.map(String).filter(Boolean)
      : [],
    correction: parsed.correction === true,
    about: Array.isArray(parsed.about) ? parsed.about.map(String) : [],
    done,
    ...(lines ? { lines } : {}),
  };
}

export function parseJudgement(
  text: string,
  checklist: BuilderEvalChecklistItem[],
): BuilderEvalJudgement | null {
  const parsed = parseFirstJsonObject(stripFence(text));
  if (!parsed || !Array.isArray(parsed.items)) return null;
  const verdicts = new Map<string, { met: boolean; evidence: string }>();
  for (const item of parsed.items) {
    const id = String(item?.id ?? '').trim();
    if (id) {
      verdicts.set(id, {
        met: item?.met === true,
        evidence: String(item?.evidence ?? '').slice(0, 400),
      });
    }
  }
  // Every checklist item gets a verdict; one the judge skipped is unmet, so a
  // judge that answers less cannot score higher.
  const items = checklist.map((item) => ({
    id: item.id,
    met: verdicts.get(item.id)?.met ?? false,
    evidence: verdicts.get(item.id)?.evidence ?? 'not judged',
  }));
  const met = items.filter((item) => item.met).length;
  return {
    met,
    total: items.length,
    score: items.length ? met / items.length : 1,
    items,
  };
}

/** One brief line as the simulated admin and the transcript read it. */
export function briefLineText(line: BuilderBriefLine): string {
  const label =
    line.kind === 'proposal'
      ? `proposal (${line.approach ?? '?'})${line.part ? ` ${line.part}` : ''}`
      : line.kind === 'repo'
        ? `repo ${line.repo}`
        : line.kind === 'exists'
          ? 'exists'
          : 'already met';
  const cites = line.cites.length
    ? ` [${line.cites.map((cite) => cite.label).join(' | ')}]`
    : '';
  return `${line.id} ${label}: ${line.text}${cites}`;
}

/** The admin's reply as the message the interview receives. */
export function replyToMessage(
  reply: SimulatedAdminReply,
  question: { id?: string; options?: { id: string; label: string }[] } | null,
  brief?: BuilderSituationBrief | null,
): CreateBuilderMessageDto {
  // A brief is answered line by line, the way the card does it: a line the
  // admin did not mention is confirmed, and anything else they said is the
  // note under it.
  if (brief && !question) {
    const verdicts = new Map(
      (reply.lines ?? []).map((line) => [line.id, line]),
    );
    const lines = brief.lines.map(
      (line) =>
        verdicts.get(line.id) ?? { id: line.id, verdict: 'confirm' as const },
    );
    const corrected = lines.filter((line) => line.verdict === 'correct').length;
    return {
      message:
        reply.message ||
        (corrected ? `Corrected ${corrected} line(s).` : 'Confirmed.'),
      briefResponse: {
        briefId: brief.id,
        lines,
        ...(reply.message ? { note: reply.message } : {}),
      },
    } as CreateBuilderMessageDto;
  }
  const options = question?.options ?? [];
  const picked = options.filter((option) =>
    reply.optionIds.includes(option.id),
  );
  if (question?.id && picked.length) {
    const labels = picked.map((option) => option.label).join(', ');
    const extra =
      reply.message && reply.message !== labels ? reply.message : '';
    return {
      message: labels,
      questionId: question.id,
      answer: {
        selectedOptionIds: picked.map((option) => option.id),
        ...(extra ? { customValues: [extra] } : {}),
      },
    } as CreateBuilderMessageDto;
  }
  return {
    message: reply.message,
    ...(question?.id ? { questionId: question.id } : {}),
  } as CreateBuilderMessageDto;
}

const prdForPrompt = (draft: BuilderPrdDocument | null | undefined): string => {
  if (!draft) return '{}';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { technicalDesign, ui, ...rest } = draft;
  const text = JSON.stringify(rest);
  return text.length > PRD_FOR_PROMPT_MAX_CHARS
    ? `${text.slice(0, PRD_FOR_PROMPT_MAX_CHARS)}…`
    : text;
};

/**
 * Plays one fixture once.
 *
 * An `interview` fixture is replayed through the real interview loop in a
 * sandbox: the admin's opening message, then a simulated admin answering
 * Builder from the recorded admin's words and the ground truth — and
 * correcting it wherever the truth contradicts it — until the PRD reads
 * ready, the admin has nothing more to say, or the turn budget runs out.
 *
 * A `prd_review` fixture checks the critic alone: the PRD, evidence and
 * transcript are loaded into the sandbox and readiness is settled, which runs
 * the cold reviewer; the outcome must match what the fixture expects.
 */
@Injectable()
export class BuilderEvalRunnerService {
  private readonly logger = LoggerService.getInstance(
    BuilderEvalRunnerService.name,
  );

  constructor(private readonly sandboxFactory: BuilderEvalSandboxFactory) {}

  async run(
    fixture: BuilderEvalFixture,
    context: {
      evalRunId: string;
      userId: number;
      overrides?: BuilderEvalOverrides | null;
    },
  ): Promise<BuilderEvalRunResult> {
    try {
      return fixture.kind === 'prd_review'
        ? await this.runPrdReview(
            fixture,
            fixture.payload as BuilderEvalPrdReviewPayload,
            context,
          )
        : await this.runInterview(
            fixture,
            fixture.payload as BuilderEvalInterviewPayload,
            context,
          );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Builder eval run ${context.evalRunId} (${fixture.name}) errored: ${message}`,
      );
      return {
        status: 'errored',
        gates: null,
        metrics: null,
        judge: null,
        critic: null,
        transcript: null,
        finalPrd: null,
        error: message.slice(0, 2000),
      };
    }
  }

  private async runInterview(
    fixture: BuilderEvalFixture,
    payload: BuilderEvalInterviewPayload,
    context: {
      evalRunId: string;
      userId: number;
      overrides?: BuilderEvalOverrides | null;
    },
  ): Promise<BuilderEvalRunResult> {
    const started = Date.now();
    const sandbox = this.sandboxFactory.create({
      evalRunId: context.evalRunId,
      title: fixture.name,
      userId: context.userId,
      handoffContext: payload.handoffContext ?? null,
      overrides: context.overrides,
      pins: payload.pins,
    });
    const sessionId = sandbox.session.id;
    const maxTurns = Math.max(1, payload.maxTurns ?? BUILDER_EVAL_MAX_TURNS);
    const transcript: BuilderEvalTurnRecord[] = [];
    const correctedItems = new Set<string>();
    let corrections = 0;
    let turns = 0;
    let message: CreateBuilderMessageDto = {
      message: payload.openingMessage,
    } as CreateBuilderMessageDto;
    let adminSaid = payload.openingMessage;
    let adminCorrected = false;
    let messages: BuilderMessage[] = [];
    let questionsSoFar = 0;
    let briefLines: number | null = null;
    let briefBeforeFirstQuestion = false;
    let briefCorrections = 0;

    while (turns < maxTurns) {
      turns += 1;
      for await (const frame of sandbox.orchestrator.streamTurn(
        sessionId,
        message,
        context.userId,
      )) {
        // The interview reports a failed turn as a frame and settles the row;
        // the transcript records it, and the next admin message carries on,
        // the way a person would retry.
        void frame;
      }
      messages =
        await sandbox.stores.messageRepository.listBySession(sessionId);
      const reply = [...messages]
        .reverse()
        .find((row) => row.role === BuilderMessageRole.ASSISTANT);
      const question = (reply?.metadata?.questions ?? [])[0] ?? null;
      const brief = storedSituationBrief(reply?.metadata);
      if (brief) {
        briefLines = brief.lines.length;
        briefBeforeFirstQuestion = questionsSoFar === 0;
      }
      questionsSoFar += Array.isArray(reply?.metadata?.questions)
        ? reply!.metadata!.questions.length
        : 0;
      transcript.push(
        this.turnRecord(turns, adminSaid, adminCorrected, reply, question),
      );

      if (sandbox.session.status === BuilderSessionStatus.PRD_READY) break;

      const admin = await this.adminReply(
        sandbox,
        payload,
        messages,
        reply,
        question,
        brief,
      );
      // A brief is a question: the admin answers it even when they say
      // they are done.
      if (admin.done && !brief) break;
      const briefCorrected = brief
        ? (admin.lines ?? []).filter((line) => line.verdict === 'correct')
            .length
        : 0;
      briefCorrections += briefCorrected;
      if (admin.correction || briefCorrected) {
        corrections += 1;
        admin.about.forEach((id) => correctedItems.add(id));
      }
      message = replyToMessage(admin, question, brief);
      adminSaid = admin.message;
      adminCorrected = admin.correction;
    }

    const doc = await sandbox.stores.docRepository.findBySession(sessionId);
    const draft = doc?.draft ?? null;
    const readiness: BuilderPrdReadiness = doc
      ? await sandbox.readiness.assess(sessionId, doc)
      : { score: 0, ready: false, sections: [], blockers: [] };
    const gates = computeEvalGates(sandbox.passes, messages, readiness);
    const judge = await this.judge(sandbox, payload.checklist ?? [], draft);

    // A turn-ending call the validated loop sent back is neither a question
    // the admin saw nor a tool that failed — it is the loop doing its job.
    const toolResults = messages
      .flatMap((row) => row.toolResults ?? [])
      .filter((result) => !BUILDER_TERMINAL_TOOLS.has(String(result?.name)));
    const metrics: BuilderEvalMetrics = {
      loop: sandbox.validatedTurns ? 'validated' : 'legacy',
      protocol: sandbox.validatedTurns && sandbox.situationBrief,
      briefDelivered: briefLines !== null,
      briefBeforeFirstQuestion,
      briefLines: briefLines ?? 0,
      briefCorrections,
      turns,
      // Questions delivered, not ask_admin calls made: the same count on the
      // legacy loop, where every call was delivered.
      questions: messages.reduce(
        (sum, row) =>
          sum +
          (Array.isArray(row.metadata?.questions)
            ? row.metadata.questions.length
            : 0),
        0,
      ),
      corrections,
      correctedItems: [...correctedItems],
      readyReached: sandbox.session.status === BuilderSessionStatus.PRD_READY,
      readinessScore: readiness.score,
      toolCalls: toolResults.length,
      toolFailures: toolResults.filter((result) => result?.result?.ok === false)
        .length,
      costUsd: Math.round(sandbox.costUsd() * 10_000) / 10_000,
      durationMs: Date.now() - started,
    };
    const judgedClean = judge.total === 0 || judge.met === judge.total;
    const passed =
      gateViolations(gates) === 0 &&
      corrections === 0 &&
      metrics.readyReached &&
      judgedClean;

    return {
      status: passed ? 'passed' : 'failed',
      gates,
      metrics,
      judge,
      critic: null,
      transcript,
      finalPrd: draft,
      error: null,
    };
  }

  private async runPrdReview(
    fixture: BuilderEvalFixture,
    payload: BuilderEvalPrdReviewPayload,
    context: {
      evalRunId: string;
      userId: number;
      overrides?: BuilderEvalOverrides | null;
    },
  ): Promise<BuilderEvalRunResult> {
    const started = Date.now();
    const sandbox = this.sandboxFactory.create({
      evalRunId: context.evalRunId,
      title: fixture.name,
      userId: context.userId,
      overrides: context.overrides,
    });
    const sessionId = sandbox.session.id;
    const { stores, prdService } = sandbox;

    for (const line of payload.transcript ?? []) {
      await stores.messageRepository.appendMessage(sessionId, {
        role:
          line.role === 'admin'
            ? BuilderMessageRole.USER
            : BuilderMessageRole.ASSISTANT,
        content: line.text,
        createdBy: context.userId,
      });
    }
    for (const [paths, ok] of [
      [payload.evidence?.readOk ?? [], true],
      [payload.evidence?.readFailed ?? [], false],
    ] as [string[], boolean][]) {
      for (const source of paths) {
        await stores.evidenceRepository.insert({
          sessionId,
          tool: 'github_read_file',
          source,
          ok,
          excerpt: ok ? null : 'Not Found',
        });
      }
    }

    // Written after the transcript, the way a PRD is edited after the
    // conversation that produced it, through the real patch path so it is
    // normalised and versioned like any other.
    const empty = await prdService.getOrCreateDoc(
      sessionId,
      context.userId,
      fixture.name,
    );
    const prd = payload.prd as unknown as Record<string, unknown>;
    const ops = Object.keys(prd)
      .filter((key) => key !== 'technicalDesign' && key !== 'ui')
      .map((key) => ({ op: 'add' as const, path: `/${key}`, value: prd[key] }));
    const { doc } = await prdService.applyPatch(
      empty,
      ops,
      context.userId,
      BuilderPrdVersionAuthor.AGENT,
      'eval fixture',
    );

    const readiness = await sandbox.readiness.settle(
      sessionId,
      doc,
      'turn_end',
    );
    const blockingRows = readiness.sections
      .filter((section) => !section.ok)
      .map((section) => section.key);
    const findings = (readiness.review?.findings ?? [])
      .filter((finding) => finding.status === 'open')
      .map(({ id, category, detail }) => ({ id, category, detail }));
    const via = payload.expect?.via;
    const blocked = blockingRows.length > 0;
    const asExpected = payload.expect?.blocking
      ? blocked &&
        (!via ||
          blockingRows.includes(via) ||
          findings.some((finding) => finding.category === via))
      : !blocked;

    return {
      status: asExpected ? 'passed' : 'failed',
      gates: null,
      metrics: {
        turns: 0,
        questions: 0,
        corrections: 0,
        correctedItems: [],
        readyReached: readiness.ready,
        readinessScore: readiness.score,
        toolCalls: 0,
        toolFailures: 0,
        costUsd: Math.round(sandbox.costUsd() * 10_000) / 10_000,
        durationMs: Date.now() - started,
      },
      judge: null,
      critic: { blockingRows, findings, asExpected },
      transcript: null,
      finalPrd: doc.draft,
      error: null,
    };
  }

  /** The simulated admin's next message. One retry, then a neutral answer. */
  private async adminReply(
    sandbox: BuilderEvalSandbox,
    payload: BuilderEvalInterviewPayload,
    messages: BuilderMessage[],
    reply: BuilderMessage | undefined,
    question: Record<string, any> | null,
    brief: BuilderSituationBrief | null = null,
  ): Promise<SimulatedAdminReply> {
    const doc = await sandbox.stores.docRepository.findBySession(
      sandbox.session.id,
    );
    const prompt = [
      '<ground_truth>',
      JSON.stringify(payload.checklist ?? []),
      '</ground_truth>',
      '',
      '<admin_script>',
      (payload.adminScript ?? [])
        .map((line, index) => `${index + 1}. ${line}`)
        .join('\n') || '(none)',
      '</admin_script>',
      '',
      '<conversation>',
      renderTranscriptForReview(messages, ADMIN_TRANSCRIPT_BUDGET) || '(empty)',
      '</conversation>',
      '',
      '<builder_latest>',
      String(reply?.content ?? '(Builder said nothing)'),
      '</builder_latest>',
      '',
      '<question>',
      question ? JSON.stringify(question) : '(no question asked)',
      '</question>',
      ...(brief && !question
        ? [
            '',
            '<situation_brief>',
            ...brief.lines.map((line) => briefLineText(line)),
            '</situation_brief>',
          ]
        : []),
      '',
      '<prd>',
      prdForPrompt(doc?.draft),
      '</prd>',
    ].join('\n');

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await sandbox.llmCompletion.complete({
          taskId: BUILDER_AI_TASKS.EVAL_ADMIN,
          task: LlmTask.BUILDER_EVAL,
          system: BUILDER_EVAL_ADMIN_SYSTEM_PROMPT,
          prompt,
          maxTokens: ADMIN_MAX_TOKENS,
          jsonMode: true,
          usageMetadata: { role: 'simulated_admin' },
        });
        const parsed = parseAdminReply(result.text);
        if (parsed) return parsed;
      } catch (error) {
        this.logger.warn(
          `Simulated admin failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      message: 'Go with your recommendation.',
      optionIds: [],
      correction: false,
      about: [],
      done: false,
    };
  }

  /** Score the final PRD against the checklist. Never decides a gate on its own. */
  private async judge(
    sandbox: BuilderEvalSandbox,
    checklist: BuilderEvalChecklistItem[],
    draft: BuilderPrdDocument | null,
  ): Promise<BuilderEvalJudgement> {
    if (!checklist.length) {
      return { met: 0, total: 0, score: 1, items: [] };
    }
    try {
      const result = await sandbox.llmCompletion.complete({
        taskId: BUILDER_AI_TASKS.EVAL_JUDGE,
        task: LlmTask.BUILDER_EVAL,
        system: BUILDER_EVAL_JUDGE_SYSTEM_PROMPT,
        prompt: [
          '<checklist>',
          JSON.stringify(checklist),
          '</checklist>',
          '',
          '<prd>',
          prdForPrompt(draft),
          '</prd>',
        ].join('\n'),
        maxTokens: JUDGE_MAX_TOKENS,
        jsonMode: true,
        usageMetadata: { role: 'judge' },
      });
      const judgement = parseJudgement(result.text, checklist);
      if (!judgement) throw new Error('the judge returned no item list');
      return { ...judgement, model: result.model };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        met: 0,
        total: checklist.length,
        score: 0,
        items: [],
        error: message.slice(0, 300),
      };
    }
  }

  private turnRecord(
    turn: number,
    admin: string,
    correction: boolean,
    reply: BuilderMessage | undefined,
    question: Record<string, any> | null,
  ): BuilderEvalTurnRecord {
    const results = new Map<string, Record<string, any>>(
      (reply?.toolResults ?? []).map((result) => [
        String(result.toolUseId),
        result,
      ]),
    );
    return {
      turn,
      admin: admin.slice(0, 4000),
      ...(correction ? { correction: true } : {}),
      builder: String(
        reply?.content ?? reply?.metadata?.errorMessage ?? '',
      ).slice(0, 6000),
      question: question?.prompt ? String(question.prompt) : null,
      ...(storedSituationBrief(reply?.metadata)
        ? {
            brief: storedSituationBrief(reply?.metadata)!.lines.map((line) =>
              briefLineText(line).slice(0, 400),
            ),
          }
        : {}),
      toolCalls: (reply?.toolCalls ?? []).map((call) => {
        const result = results.get(String(call.id))?.result;
        return {
          name: String(call.name),
          ok: result?.ok !== false,
          ...(result?.ok === false
            ? {
                summary: String(result?.message ?? result?.error ?? '').slice(
                  0,
                  300,
                ),
              }
            : {}),
        };
      }),
    };
  }
}
