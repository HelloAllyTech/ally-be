import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ImprovementRun } from '../entity/improvement-run.entity';
import { ImprovementRound } from '../entity/improvement-round.entity';
import { CritiqueProposal } from '../entity/critique-proposal.entity';
import { ImprovementRunOutcome } from '../enum/improvement-run.enum';
import { CopilotMessageRole } from '../enum/copilot-message-role.enum';
import { CopilotMessageRepository } from '../repository/copilot-message.repository';
import { ImprovementRoundRepository } from '../repository/improvement-round.repository';
import { RehearsalComparison } from './rehearsal-comparison.service';

/**
 * Narrates auto-improve progress into the copilot chat that started the run
 * (run.config.copilotSessionId). Every poster:
 *  - no-ops when the run isn't copilot-linked;
 *  - swallows + logs ALL errors — narration must never break the loop.
 *
 * Rows are plain-content ASSISTANT messages (replay-safe through
 * rebuildAnthropicHistory — the model sees the loop context in later turns);
 * `metadata` carries the structured payload the studio renders as progress /
 * ready cards:
 *   progress: { kind:'improvement_update', subkind:'round_scored'|
 *     'proposals_applied'|'finished'|'failed', improvementRunId, roundNumber?,
 *     roundKind?, scores?, deltas?, proposals?, outcome?, trajectory? }
 *   ready:    { kind:'improvement_ready', improvementRunId, specId,
 *     bestVersionId, acceptedVersionId, scores }
 */
@Injectable()
export class ImprovementNarrationService {
  private readonly logger = LoggerService.getInstance(
    ImprovementNarrationService.name,
  );

  constructor(
    private readonly copilotMessageRepository: CopilotMessageRepository,
    private readonly improvementRoundRepository: ImprovementRoundRepository,
  ) {}

  async postRoundScored(
    run: ImprovementRun,
    round: ImprovementRound,
    deltas: {
      vsPrevious: RehearsalComparison | null;
      vsBaseline: RehearsalComparison | null;
    },
  ): Promise<void> {
    const scores = this.scoresSummary(round.scores);
    const deltaBits: string[] = [];
    const vsPrevious = deltas.vsPrevious?.overall?.delta;
    const vsBaseline = deltas.vsBaseline?.overall?.delta;
    if (vsPrevious !== null && vsPrevious !== undefined) {
      deltaBits.push(`${this.signed(vsPrevious)} vs the previous round`);
    }
    if (vsBaseline !== null && vsBaseline !== undefined) {
      deltaBits.push(`${this.signed(vsBaseline)} vs the baseline`);
    }
    const content =
      `**Round ${round.roundNumber} (${this.kindLabel(round.kind)}) rehearsed** — ` +
      `overall **${scores.overall ?? '?'}**` +
      (deltaBits.length > 0 ? ` (${deltaBits.join(', ')})` : '') +
      this.testsSentence(scores.testCounts);

    await this.post(run, content, {
      kind: 'improvement_update',
      subkind: 'round_scored',
      improvementRunId: run.id,
      roundNumber: round.roundNumber,
      roundKind: round.kind,
      scores,
      deltas: {
        overallVsPrevious: vsPrevious ?? null,
        overallVsBaseline: vsBaseline ?? null,
      },
    });
  }

  async postProposalsApplied(
    run: ImprovementRun,
    round: ImprovementRound,
    applied: CritiqueProposal[],
  ): Promise<void> {
    const summaries = applied.map((proposal) => proposal.summary);
    const content =
      `**Applying ${applied.length} fix${applied.length === 1 ? '' : 'es'}** from the round ${round.roundNumber} critique:\n` +
      summaries.map((summary) => `- ${summary}`).join('\n') +
      `\n\nRe-rehearsing with the fixes in place…`;

    await this.post(run, content, {
      kind: 'improvement_update',
      subkind: 'proposals_applied',
      improvementRunId: run.id,
      roundNumber: round.roundNumber,
      proposals: applied.map((proposal) => ({
        summary: proposal.summary,
        targetSection: proposal.targetSection,
        severity: proposal.severity,
      })),
    });
  }

  /** Weaker outcomes: summary + the explicit decision ask (the loop can't
   *  call ask_trainer, so the question lives in the message itself). */
  async postFinished(
    run: ImprovementRun,
    outcome: ImprovementRunOutcome,
  ): Promise<void> {
    const trajectory = await this.trajectory(run.id);
    const outcomeLine = this.outcomeLine(outcome);
    const best = trajectory.find(
      (entry) => entry.candidateVersionId === run.bestVersionId,
    );
    const bestLine = best
      ? `Best result: round ${best.roundNumber} — overall **${best.overall ?? '?'}**${this.testsSentence(best.testCounts)}.`
      : 'No round produced a scoreable result.';

    const content =
      `**Auto-improve finished — ${outcomeLine}**\n\n${bestLine}\n\n` +
      (run.bestVersionId && run.bestVersionId !== run.baseVersionId
        ? 'Would you like me to **accept the best version** into your draft, ' +
          '**keep the current draft** as is, or accept it and **run another improvement pass**?'
        : 'The baseline remained the best result — your current draft is unchanged. ' +
          'I can suggest targeted manual fixes from the rehearsal evidence, or we can adjust the design and try again.');

    await this.post(run, content, {
      kind: 'improvement_update',
      subkind: 'finished',
      improvementRunId: run.id,
      outcome,
      scores: best
        ? { overall: best.overall, testCounts: best.testCounts }
        : null,
      trajectory,
    });
  }

  /** TARGETS_MET + auto-accepted: the "ready to test live & publish" card. */
  async postReady(run: ImprovementRun): Promise<void> {
    const trajectory = await this.trajectory(run.id);
    const best = trajectory.find(
      (entry) => entry.candidateVersionId === run.bestVersionId,
    );
    const scores = best
      ? { overall: best.overall, testCounts: best.testCounts }
      : null;
    const content =
      `🎉 **Your roleplay hit its quality targets and the improved version has been applied to your draft.**\n\n` +
      (best
        ? `Final verification: overall **${best.overall ?? '?'}**${this.testsSentence(best.testCounts)}.\n\n`
        : '') +
      `It's ready — use the buttons below to **test it live** or **publish** it.`;

    await this.post(run, content, {
      kind: 'improvement_ready',
      improvementRunId: run.id,
      specId: run.specId,
      bestVersionId: run.bestVersionId ?? null,
      acceptedVersionId: run.acceptedVersionId ?? null,
      scores,
    });
  }

  async postFailed(run: ImprovementRun, message: string): Promise<void> {
    await this.post(
      run,
      `**Auto-improve stopped:** ${message}\n\nYour draft is unchanged. We can try again, or I can help you adjust the design first.`,
      {
        kind: 'improvement_update',
        subkind: 'failed',
        improvementRunId: run.id,
        outcome: run.outcome ?? null,
      },
    );
  }

  // ------------------------------------------------------------------ guts

  private async post(
    run: ImprovementRun,
    content: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    const sessionId = run.config?.copilotSessionId as string | undefined;
    if (!sessionId) return;
    try {
      await this.copilotMessageRepository.appendMessage(sessionId, {
        role: CopilotMessageRole.ASSISTANT,
        content,
        metadata,
        createdBy: run.createdBy,
      });
    } catch (error) {
      this.logger.warn(
        `Improvement narration failed for run ${run.id} (session ${sessionId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async trajectory(runId: string): Promise<
    Array<{
      roundNumber: number;
      kind: string;
      candidateVersionId: string;
      overall: number | null;
      testCounts: Record<string, number> | null;
    }>
  > {
    try {
      const rounds = await this.improvementRoundRepository.listByRun(runId);
      return rounds
        .filter((round) => round.scores)
        .map((round) => ({
          roundNumber: round.roundNumber,
          kind: round.kind,
          candidateVersionId: round.candidateVersionId,
          overall: (round.scores?.overall as number | undefined) ?? null,
          testCounts:
            (round.scores?.test_counts as Record<string, number>) ?? null,
        }));
    } catch (error) {
      this.logger.warn(
        `Could not load trajectory for run ${runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private scoresSummary(scores: Record<string, any> | null | undefined): {
    overall: number | null;
    testCounts: Record<string, number> | null;
  } {
    return {
      overall: (scores?.overall as number | undefined) ?? null,
      testCounts:
        (scores?.test_counts as Record<string, number> | undefined) ?? null,
    };
  }

  private testsSentence(
    testCounts: Record<string, number> | null | undefined,
  ): string {
    if (!testCounts) return '';
    const total =
      (testCounts.passed ?? 0) +
      (testCounts.failed ?? 0) +
      (testCounts.inconclusive ?? 0);
    if (total === 0) return '';
    return `, test cases ${testCounts.passed ?? 0}/${total} passing`;
  }

  private signed(delta: number): string {
    return delta >= 0 ? `+${delta}` : `${delta}`;
  }

  private kindLabel(kind: string): string {
    switch (kind) {
      case 'BASELINE':
        return 'baseline';
      case 'FINAL_VERIFICATION':
        return 'final verification';
      default:
        return 'iteration';
    }
  }

  private outcomeLine(outcome: ImprovementRunOutcome): string {
    switch (outcome) {
      case ImprovementRunOutcome.MAX_ROUNDS:
        return 'reached the round limit before hitting every target';
      case ImprovementRunOutcome.NO_PROPOSALS:
        return 'the critic ran out of new fixes to try';
      case ImprovementRunOutcome.NO_IMPROVEMENT:
        return 'no round beat the baseline';
      case ImprovementRunOutcome.TIMED_OUT:
        return 'timed out (showing the best result so far)';
      case ImprovementRunOutcome.REHEARSAL_FAILED:
        return 'a rehearsal failed';
      case ImprovementRunOutcome.TARGETS_MET:
        return 'targets met';
      default:
        return String(outcome).toLowerCase().replace(/_/g, ' ');
    }
  }
}
