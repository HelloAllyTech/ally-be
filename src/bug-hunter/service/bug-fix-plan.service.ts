import { Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHunterEngine } from '../type/bug-hunter-model-settings.type';
import {
  BUG_HUNTER_FIX_MODEL_MENU,
  BUG_HUNTER_DECISION_OWNER_DEFAULTS,
  FixPlan,
  FixRetry,
} from '../type/bug-hunter-orchestrator.type';
import { BugHunterDecisionService } from './bug-hunter-decision.service';
import { BugHunterModelSettingsService } from './bug-hunter-model-settings.service';
import { BugHunterScoreboardService } from './bug-hunter-scoreboard.service';

type MenuEntry = (typeof BUG_HUNTER_FIX_MODEL_MENU)[number];
type D6Pick = {
  engine: BugHunterEngine;
  model: string;
  approach: string | null;
};

const APPROACH_MAX = 300;

/**
 * D6 — which approach and which model a fix session runs with (OPP-0783).
 *
 * Made once per dispatch, before the workflow starts, and stored on the
 * finding as `metadata.fixPlan` so `GET pipeline/models?role=fix` can hand
 * the workflow the chosen engine and model, and the fix brief can carry the
 * approach as a suggestion. Model-owned with the rule shadowing: the rule
 * is the platform default on a first attempt and the strong tier, on a
 * different model where the menu has one, on every retry.
 *
 * Its own small service rather than a method on the orchestrator because
 * the fix-session service calls it from inside `dispatchFix`, and the
 * orchestrator depends on the fix-session service — this breaks the cycle.
 */
@Injectable()
export class BugFixPlanService {
  private readonly logger = LoggerService.getInstance(BugFixPlanService.name);

  constructor(
    private readonly decisions: BugHunterDecisionService,
    private readonly scoreboard: BugHunterScoreboardService,
    private readonly modelSettingsService: BugHunterModelSettingsService,
    private readonly findingRepository: BugFindingRepository,
  ) {}

  /** Best-effort: a plan that cannot be made leaves the workflow on the platform default, which is what every session got before this existed. */
  async plan(
    finding: BugFinding,
    repo: string,
    retry: FixRetry | null,
  ): Promise<FixPlan | null> {
    try {
      const settings = await this.modelSettingsService.get();
      const board = await this.scoreboard.forRepo(repo).catch(() => null);
      const previous = finding.metadata?.fixPlan as FixPlan | undefined;
      const attempt = (previous?.attempt ?? 0) + 1;
      const platformDefault =
        BUG_HUNTER_FIX_MODEL_MENU.find(
          (m) =>
            m.engine === settings.engine && m.model === settings.defaultModel,
        ) ??
        BUG_HUNTER_FIX_MODEL_MENU.find((m) => m.tier === 'strong') ??
        BUG_HUNTER_FIX_MODEL_MENU[0];

      const rule = (): D6Pick => {
        if (!retry) return { ...platformDefault, approach: null };
        // A retry goes to the strong tier, on a different model than the
        // one that just failed where the menu offers one.
        const strong = BUG_HUNTER_FIX_MODEL_MENU.filter(
          (m) => m.tier === 'strong',
        );
        const other = strong.find(
          (m) =>
            !previous ||
            m.model !== previous.model ||
            m.engine !== previous.engine,
        );
        const entry = other ?? strong[0] ?? platformDefault;
        return { engine: entry.engine, model: entry.model, approach: null };
      };

      const context = {
        repo,
        attempt,
        retry: retry
          ? {
              kind: retry.kind,
              move: retry.move,
              failures: retry.failures.slice(0, 6),
            }
          : null,
        previousModel: previous
          ? { engine: previous.engine, model: previous.model }
          : null,
        finding: {
          source: finding.source,
          severity: finding.severity,
          touchesGuardedPath: finding.touchesGuardedPath,
          title: finding.title,
          file: finding.file,
        },
        platformDefault: {
          engine: platformDefault.engine,
          model: platformDefault.model,
        },
        fixByModel: board?.fixByModel ?? {},
        postmortem: finding.metadata?.postmortem
          ? {
              rootCauseHypothesis: String(
                (finding.metadata.postmortem as Record<string, unknown>)
                  .rootCauseHypothesis ?? '',
              ).slice(0, 300),
              tryNext: String(
                (finding.metadata.postmortem as Record<string, unknown>)
                  .tryNext ?? '',
              ).slice(0, 300),
            }
          : null,
      };

      const d6 = await this.decisions.decide<D6Pick>({
        point: 'D6',
        question: 'approach',
        repo,
        runId: null,
        findingId: finding.id,
        menu: BUG_HUNTER_FIX_MODEL_MENU.map(({ engine, model, tier }) => ({
          engine,
          model,
          tier,
        })),
        context,
        modelOwned: BUG_HUNTER_DECISION_OWNER_DEFAULTS.D6 === 'model',
        rule,
        validate: (raw) => validateD6(raw),
      });

      const entry: MenuEntry =
        BUG_HUNTER_FIX_MODEL_MENU.find(
          (m) => m.engine === d6.pick.engine && m.model === d6.pick.model,
        ) ?? platformDefault;
      const plan: FixPlan = {
        engine: entry.engine,
        model: entry.model,
        tier: entry.tier,
        approach: d6.pick.approach,
        attempt,
        decisionId: d6.record.id,
        plannedAt: new Date().toISOString(),
      };
      await this.findingRepository.update(finding.id, {
        metadata: {
          ...(finding.metadata ?? {}),
          fixPlan: plan,
        } as Record<string, any>,
      });
      finding.metadata = { ...(finding.metadata ?? {}), fixPlan: plan };
      return plan;
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] D6 could not plan the fix for ${finding.id}; the platform default runs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

/** A D6 answer is on the menu or it is nothing; the approach is clipped, never trusted as an instruction. */
export function validateD6(raw: unknown): D6Pick | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const engine = typeof r.engine === 'string' ? r.engine : null;
  const model = typeof r.model === 'string' ? r.model : null;
  const entry = BUG_HUNTER_FIX_MODEL_MENU.find(
    (m) => m.engine === engine && m.model === model,
  );
  if (!entry) return null;
  const approach =
    typeof r.approach === 'string' && r.approach.trim()
      ? r.approach.trim().slice(0, APPROACH_MAX)
      : null;
  return { engine: entry.engine, model: entry.model, approach };
}
