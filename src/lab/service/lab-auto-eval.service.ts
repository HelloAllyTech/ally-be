import { BadRequestException, Injectable } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { LabAutoEvaluationRepository } from '../repository/lab-auto-evaluation.repository';
import { LabAutoEvaluation } from '../entity/lab-auto-evaluation.entity';
import { LabRunService } from './lab-run.service';
import { LabRunStatus } from '../entity/lab-run.entity';
import { CreateAutoEvalDto } from '../dto/lab-auto-eval.dto';

/** Parsed judge verdict. */
interface JudgeVerdict {
  score: number | null;
  reasoning: string | null;
}

@Injectable()
export class LabAutoEvalService {
  private readonly logger = LoggerService.getInstance(LabAutoEvalService.name);

  constructor(
    private readonly autoEvalRepository: LabAutoEvaluationRepository,
    private readonly runService: LabRunService,
  ) {}

  listForRun(runId: string): Promise<LabAutoEvaluation[]> {
    return this.autoEvalRepository.listForRun(runId);
  }

  /**
   * Score a completed run's output against a rubric using an LLM judge, and
   * persist the verdict. Throws if the run isn't COMPLETED (nothing to judge).
   * A judge/parse failure is recorded on the row (error) rather than thrown, so
   * the attempt is still visible.
   */
  async evaluate(
    runId: string,
    dto: CreateAutoEvalDto,
  ): Promise<LabAutoEvaluation> {
    const run = await this.runService.getById(runId);
    if (run.status !== LabRunStatus.COMPLETED || !run.output) {
      throw new BadRequestException(
        'Only completed runs with output can be auto-evaluated',
      );
    }

    const model = dto.model || this.runService.getDefaultModel();
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const record = this.autoEvalRepository.create({
      runId,
      model,
      criteria: dto.criteria,
      createdBy: userId,
    });

    try {
      const { text } = await this.runService.callModel(
        model,
        this.buildJudgePrompt(dto.criteria, run.resolvedPrompt, run.output),
        { temperature: 0 },
      );
      const verdict = this.parseVerdict(text);
      record.score = verdict.score;
      record.reasoning = verdict.reasoning;
      if (verdict.score == null) {
        record.error = 'Could not parse a score from the judge response';
      }
      this.logger.info(
        `[AI_LAB] auto-eval for run ${runId} scored ${verdict.score ?? 'n/a'}`,
      );
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[AI_LAB] auto-eval for run ${runId} failed: ${record.error}`,
      );
    }

    return this.autoEvalRepository.save(record);
  }

  private buildJudgePrompt(
    criteria: string,
    resolvedPrompt: string,
    output: string,
  ): string {
    return [
      "You are a strict evaluator scoring an AI assistant's output.",
      'Score the ASSISTANT OUTPUT against the CRITERIA on a 0-100 scale.',
      'Respond with ONLY a JSON object, no prose, of the form:',
      '{"score": <integer 0-100>, "reasoning": "<one or two sentences>"}',
      '',
      `CRITERIA:\n${criteria}`,
      '',
      `PROMPT SENT TO THE ASSISTANT:\n${resolvedPrompt}`,
      '',
      `ASSISTANT OUTPUT:\n${output}`,
    ].join('\n');
  }

  /**
   * Extract {score, reasoning} from the judge's text. Tolerates surrounding
   * prose by scanning for the first balanced JSON object. Clamps score to
   * 0–100; returns null score when nothing parseable is found.
   */
  private parseVerdict(text: string): JudgeVerdict {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      return { score: null, reasoning: text.trim() || null };
    }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        score?: unknown;
        reasoning?: unknown;
      };
      const rawScore = Number(parsed.score);
      const score = Number.isFinite(rawScore)
        ? Math.max(0, Math.min(100, Math.round(rawScore)))
        : null;
      const reasoning =
        typeof parsed.reasoning === 'string' ? parsed.reasoning : null;
      return { score, reasoning };
    } catch {
      return { score: null, reasoning: text.trim() || null };
    }
  }
}
