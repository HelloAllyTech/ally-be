import { Injectable } from '@nestjs/common';
import {
  CERTIFICATION_LEVELS,
  CERTIFICATION_MIN_MONTHS,
  CERTIFICATION_PIPELINE_FRACTIONS,
  CertificationAnalyticsRepository,
  PRIMARY_CERTIFICATION_LEVEL,
} from '../repository/certification-analytics.repository';
import {
  CertificationMonthDto,
  CertificationPipelineBandDto,
  CertificationQueryDto,
  CertificationResponseDto,
} from '../dto/certification-analytics.dto';
import {
  addMonths,
  isoDate,
  startOfUtcMonth,
} from '../util/analytics-window.util';

/**
 * Ally Certification attainment for the Highlights tab's hero card.
 *
 * Shapes two result sets into one dense monthly axis plus a standing snapshot,
 * so the client renders them without doing calendar maths or running sums of its
 * own. The rules doing the work are house data-visualisation rules rather than
 * conveniences:
 *
 *  - **The axis is a real calendar.** Every month from the start of the window
 *    to the current one is present, in order, even when nothing happened in it.
 *    A month list assembled from the months that happened to have crossings
 *    invites the reader to compare two adjacent bars that are a year apart.
 *  - **The axis starts early enough to have a shape.** It runs from the first
 *    month any learner practised — so the cumulative curve begins at a true
 *    zero and the reader can see how long the climb took — but never spans
 *    fewer than {@link CERTIFICATION_MIN_MONTHS} months, so a young or quiet
 *    platform still gets a readable axis instead of one or two bars.
 *  - **The cumulative line is monotonic.** It is the running total of the
 *    monthly crossings, and a level is never lost, so it can only rise or stay
 *    flat. Anything else would mean the two series disagree, which is why it is
 *    derived here from the bars rather than queried separately.
 *  - **The current month is provisional.** More learners can still cross into
 *    it, so it is flagged rather than quietly mixed in with the finished months.
 *  - **The pipeline is as-of-now, not as-of-the-axis.** It answers "who is on
 *    the way", which is a question about today; putting it on the time axis
 *    would imply a history it does not have.
 */
@Injectable()
export class CertificationAnalyticsService {
  constructor(private readonly repository: CertificationAnalyticsRepository) {}

  async getCertification(
    query: CertificationQueryDto,
  ): Promise<CertificationResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const level = PRIMARY_CERTIFICATION_LEVEL;

    const [monthRows, pipelineRow, firstActivityMonth] = await Promise.all([
      this.repository.getCertificationMonths(level.minMinutes, tenantId),
      this.repository.getPipeline(level.minMinutes, tenantId),
      this.repository.getFirstActivityMonth(tenantId),
    ]);

    const currentMonth = startOfUtcMonth(new Date());
    const currentMonthIso = isoDate(currentMonth);
    const startMonth = resolveStartMonth(
      currentMonth,
      firstActivityMonth,
      monthRows[0]?.month,
    );

    const byMonth = new Map(monthRows.map((r) => [r.month, r.newlyCertified]));

    // Crossings that predate the axis. Real certifications, so they cannot be
    // dropped: they belong in the cumulative line's opening value or the curve
    // would start below the number of people who actually hold the level.
    const startMonthIso = isoDate(startMonth);
    let cumulative = monthRows
      .filter((r) => r.month < startMonthIso)
      .reduce((sum, r) => sum + r.newlyCertified, 0);

    const months: CertificationMonthDto[] = [];
    for (
      let monthDate = startMonth;
      isoDate(monthDate) <= currentMonthIso;
      monthDate = addMonths(monthDate, 1)
    ) {
      const month = isoDate(monthDate);
      const newlyCertified = byMonth.get(month) ?? 0;
      cumulative += newlyCertified;
      months.push({
        month,
        newlyCertified,
        cumulativeCertified: cumulative,
        partial: month === currentMonthIso,
      });
    }

    const pipeline: CertificationPipelineBandDto[] =
      CERTIFICATION_PIPELINE_FRACTIONS.slice(0, -1).map((fraction, i) => {
        const upperFraction = CERTIFICATION_PIPELINE_FRACTIONS[i + 1];
        const minMinutes = Math.round(fraction * level.minMinutes);
        const maxMinutes = Math.round(upperFraction * level.minMinutes);
        return {
          label: bandLabel(minMinutes, maxMinutes),
          minMinutes,
          maxMinutes,
          minFraction: fraction,
          learners: pipelineRow.pipelineByBand[i] ?? 0,
        };
      });

    return {
      levels: CERTIFICATION_LEVELS.map((l) => ({ ...l })),
      level: { ...level },
      months,
      currentMonth: currentMonthIso,
      // From the standing snapshot, not the tail of the axis: the two are the
      // same number by construction, and taking it from the query that measures
      // it directly means a bug in the axis maths cannot silently restate the
      // headline figure.
      certified: pipelineRow.certified,
      learners: pipelineRow.learners,
      pipeline,
      nearestMinutes: Math.round(pipelineRow.nearestMinutes),
      // Both the population (users) and the activity (user_daily_scores) carry a
      // tenant, so unlike AI cost or org counts there is nothing here that has to
      // stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * Where the axis begins: the earlier of the first practice month and the first
 * certification month, pulled back far enough to span the minimum number of
 * months, and never later than that minimum.
 *
 * The first certification is checked as well as the first practice month because
 * they can disagree — a tenant filter narrows the population but historical
 * rows are unaffected — and an axis that started after a crossing would drop a
 * bar the cumulative line still counts.
 */
function resolveStartMonth(
  currentMonth: Date,
  firstActivityMonth: string | null,
  firstCertificationMonth?: string,
): Date {
  const minimumStart = addMonths(currentMonth, -(CERTIFICATION_MIN_MONTHS - 1));
  const candidates = [firstActivityMonth, firstCertificationMonth].filter(
    (m): m is string => typeof m === 'string' && m.length > 0,
  );
  if (candidates.length === 0) return minimumStart;

  const earliest = candidates.reduce((a, b) => (a < b ? a : b));
  const earliestDate = new Date(`${earliest}T00:00:00.000Z`);
  if (Number.isNaN(earliestDate.getTime())) return minimumStart;

  return earliestDate < minimumStart ? earliestDate : minimumStart;
}

/** "Under 500 min" / "1,500–3,000 min" — the bottom band reads better open. */
function bandLabel(minMinutes: number, maxMinutes: number): string {
  const format = (n: number) => n.toLocaleString('en-US');
  if (minMinutes === 0) return `Under ${format(maxMinutes)} min`;
  return `${format(minMinutes)}–${format(maxMinutes)} min`;
}
