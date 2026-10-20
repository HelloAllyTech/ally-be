import {
  ROADMAP_BRIEF_LIMITS,
  ROADMAP_LIMITS,
} from '../constants/product-roadmap.constants';
import {
  RoadmapFilingInterviewMessage,
  RoadmapBriefEvidence,
  RoadmapBriefEvidenceSource,
  RoadmapBriefRating,
  RoadmapBriefStrategicFit,
  RoadmapOpportunityBrief,
} from '../type/roadmap-brief.type';

const RATINGS = new Set<string>(Object.values(RoadmapBriefRating));
const SOURCES = new Set<string>(Object.values(RoadmapBriefEvidenceSource));

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * An agent-written list, made safe to store and render.
 *
 * Agent-authored arrays are not well-shaped — Builder's PRD panel crashed on an
 * `acceptanceCriteria` that came back as a string — so every list goes through an
 * `Array.isArray` guard here, once, rather than at each use site.
 */
const list = <T>(
  value: unknown,
  max: number,
  map: (item: unknown) => T | null,
): T[] =>
  (Array.isArray(value) ? value : [])
    .map(map)
    .filter((item): item is T => item !== null)
    .slice(0, max);

const strings = (value: unknown, max: number): string[] =>
  list(value, max, (item) => text(item, ROADMAP_BRIEF_LIMITS.TEXT_MAX));

/**
 * The copilot's brief, coerced to the stored shape — or null when there is nothing in it.
 *
 * Applied to what the model wrote AND to what a client echoes back on the next turn: the brief
 * rides on every request and is stored on the filed row, so the caps hold whoever produced it.
 *
 * FAILS TOWARD THE WEAKEST CLAIM. An unknown rating reads as `needs_work`, never `strong`: the
 * rating is shown to voters as the copilot's judgement, and a malformed answer must not be
 * promoted into an endorsement nobody made. An unknown evidence source reads as `admin` — the
 * weakest kind — for the same reason.
 */
export const normaliseOpportunityBrief = (
  raw: unknown,
): RoadmapOpportunityBrief | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, any>;
  const L = ROADMAP_BRIEF_LIMITS;

  const strategicFit = list<RoadmapBriefStrategicFit>(
    input.strategicFit,
    L.STRATEGIC_FIT_MAX,
    (item: any) => {
      const goal = text(item?.goal, L.SHORT_TEXT_MAX);
      const why = text(item?.why, L.TEXT_MAX);
      return goal && why ? { goal, why } : null;
    },
  );

  const evidence = list<RoadmapBriefEvidence>(
    input.evidence,
    L.EVIDENCE_MAX,
    (item: any) => {
      const claim = text(item?.claim, L.TEXT_MAX);
      if (!claim) return null;
      const source = SOURCES.has(item?.source)
        ? (item.source as RoadmapBriefEvidenceSource)
        : RoadmapBriefEvidenceSource.ADMIN;
      return { source, claim, ref: text(item?.ref, L.SHORT_TEXT_MAX) };
    },
  );

  const rating = RATINGS.has(input.assessment?.rating)
    ? (input.assessment.rating as RoadmapBriefRating)
    : RoadmapBriefRating.NEEDS_WORK;
  const openRecommendations = strings(
    input.assessment?.openRecommendations,
    L.RECOMMENDATIONS_MAX,
  );

  const brief: RoadmapOpportunityBrief = {
    strategicFit,
    reach: {
      howMany: text(input.reach?.howMany, L.SHORT_TEXT_MAX),
      howOften: text(input.reach?.howOften, L.SHORT_TEXT_MAX),
    },
    evidence,
    successMetric: text(input.successMetric, L.TEXT_MAX),
    assumptions: strings(input.assumptions, L.ASSUMPTIONS_MAX),
    alternativesDropped: strings(input.alternativesDropped, L.ALTERNATIVES_MAX),
    assessment: {
      rating,
      summary: text(input.assessment?.summary, L.TEXT_MAX) ?? '',
      openRecommendations,
    },
  };

  const empty =
    !brief.strategicFit.length &&
    !brief.evidence.length &&
    !brief.reach.howMany &&
    !brief.reach.howOften &&
    !brief.successMetric &&
    !brief.assumptions.length &&
    !brief.alternativesDropped.length &&
    !brief.assessment.summary &&
    !brief.assessment.openRecommendations.length;
  return empty ? null : brief;
};

/**
 * The filing conversation, coerced to the stored shape — or null when nothing in it survives.
 *
 * NEVER THROWS, on purpose. This rides on the filing request, and a filing refused over its
 * transcript would lose the very conversation it was trying to keep. So a malformed message is
 * dropped rather than rejected, content is capped at the interview route's own per-message
 * limit, and the count at that route's message limit plus one: a turn carries at most that
 * many messages, and filing sends them together with the copilot's answer to the last.
 */
export const normaliseFilingInterview = (
  raw: unknown,
): RoadmapFilingInterviewMessage[] | null => {
  const messages = list<RoadmapFilingInterviewMessage>(
    raw,
    ROADMAP_LIMITS.OPPORTUNITY_INTERVIEW_MESSAGE_MAX + 1,
    (item: any) => {
      const role = item?.role;
      if (role !== 'admin' && role !== 'agent') return null;
      const content = text(
        item?.content,
        ROADMAP_LIMITS.OPPORTUNITY_INTERVIEW_CONTENT_MAX,
      );
      return content ? { role, content } : null;
    },
  );
  return messages.length ? messages : null;
};

/**
 * JSON with object keys sorted at every level and `undefined` dropped.
 *
 * What the readiness token signs. The brief makes a round trip through the browser and back
 * through class-transformer, which may re-order keys or materialise absent optional fields;
 * a fingerprint over plain `JSON.stringify` would then refuse a brief nobody changed.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
};
