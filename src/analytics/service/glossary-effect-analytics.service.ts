import { Injectable } from '@nestjs/common';
import {
  GlossaryEffectCellDto,
  GlossaryEffectQueryDto,
  GlossaryEffectResponseDto,
} from '../dto/glossary-effect-analytics.dto';
import { GlossaryEffectAnalyticsRepository } from '../repository/glossary-effect-analytics.repository';
import { LanguageAnalyticsRepository } from '../repository/language-analytics.repository';

/** Severity weights — the normative constants from language-eval-judge-schema.md. */
const SEVERITY_WEIGHT: Record<string, number> = {
  minor: 1,
  major: 5,
  critical: 10,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Did the glossary change anything? One answer, two metrics, four confounders
 * held constant by construction — see
 * {@link GlossaryEffectAnalyticsRepository} for the four false results that
 * motivated this surface.
 *
 * The judge tuple is pinned to the latest version with rows, reusing
 * {@link LanguageAnalyticsRepository.latestJudgeVersion} rather than a second
 * copy of that rule: mixing judge versions makes rates incomparable (NFR3),
 * and one definition of "which judge" is the whole point of putting this here.
 *
 * No scalar quality score is emitted (FR14) — the two rates are reported
 * separately and deliberately not combined. Adherence counts words the agent
 * must not say; naturalness is the judge's severity-weighted style rate. A
 * language can score perfectly on the first and still read as stilted, so
 * adherence is a floor, not a measure of quality.
 */
@Injectable()
export class GlossaryEffectAnalyticsService {
  constructor(
    private readonly repo: GlossaryEffectAnalyticsRepository,
    private readonly languageRepo: LanguageAnalyticsRepository,
  ) {}

  async getGlossaryEffect(
    query: GlossaryEffectQueryDto,
  ): Promise<GlossaryEffectResponseDto> {
    const judge = await this.languageRepo.latestJudgeVersion();
    if (!judge) {
      // No judged sessions at all: report the empty shape rather than
      // inventing a tuple, so the caller can say "not measured yet".
      return {
        judgeVersion: { judgeModel: '', judgePromptVersion: '' },
        goLive: [],
        cells: [],
      };
    }

    const filters = {
      judgeModel: judge.judgeModel,
      judgePromptVersion: judge.judgePromptVersion,
      language: query.language ?? null,
      includeTestOrganizations: query.includeTestOrganizations === 'true',
    };

    const [goLiveRows, totals, styleCounts] = await Promise.all([
      this.repo.goLiveByLanguage(),
      this.repo.totals(filters),
      this.repo.styleCounts(filters),
    ]);

    // Severity weighting lives here, not in SQL — same split as
    // LanguageAnalyticsService, so the weights have one home.
    const weightByCell = new Map<string, number>();
    for (const row of styleCounts) {
      const key = `${row.languageValue}|${row.period}|${row.agentModel}`;
      weightByCell.set(
        key,
        (weightByCell.get(key) ?? 0) +
          Number(row.count) * (SEVERITY_WEIGHT[row.severity] ?? 1),
      );
    }

    const cells: GlossaryEffectCellDto[] = totals.map((t) => {
      const key = `${t.languageValue}|${t.period}|${t.agentModel}`;
      const turns = Number(t.turns);
      const agentMessages = Number(t.agentMessages);
      return {
        languageValue: t.languageValue,
        period: t.period,
        agentModel: t.agentModel,
        sessions: Number(t.sessions),
        turns,
        agentMessages,
        adherencePer100Messages:
          agentMessages > 0
            ? round2((Number(t.avoidTermViolations) / agentMessages) * 100)
            : 0,
        // Null, not 0: no judged turns means UNMEASURED, and a zero here
        // would read as flawless. Adherence can still be 0 legitimately —
        // its denominator is agent messages, which the scan always has.
        stylePer100Turns:
          turns > 0
            ? round2(((weightByCell.get(key) ?? 0) / turns) * 100)
            : null,
        testSessionsExcluded: Number(t.testSessionsExcluded),
      };
    });

    return {
      judgeVersion: {
        judgeModel: judge.judgeModel,
        judgePromptVersion: judge.judgePromptVersion,
      },
      goLive: goLiveRows.map((g) => ({
        languageValue: g.languageValue,
        languageLabel: g.languageLabel,
        goLiveAt: new Date(g.goLiveAt).toISOString().slice(0, 10),
      })),
      cells,
    };
  }
}
