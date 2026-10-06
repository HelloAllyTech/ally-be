import {
  FHS_BEHAVIOURS_BY_CODE,
  FHS_RUBRIC,
  FhsSkill,
} from '../constants/helping-skills-rubric.constants';
import type { StoredSkillVerdict } from '../entity/foundational-skill-assessment.entity';

/**
 * The level rule, applied in code rather than asked of the model.
 *
 * The judge only ticks behaviours (with evidence). Deriving the level here is
 * the point: a model asked for "a score from 1 to 4" hides why, and routinely
 * under-applies the rule that ONE unhelpful behaviour makes the skill a 1 no
 * matter how much else went well — the rule this rubric exists to enforce.
 *
 *   any unhelpful                         -> 1
 *   not every required basic              -> 2
 *   every required basic, no advanced     -> 3
 *   every required basic + any advanced   -> 4
 *
 * "Required basic" is every basic behaviour except a `conditional` one the
 * judge marked not applicable (the client never supplied what it reacts to).
 */
export type FhsLevel = 1 | 2 | 3 | 4;

export interface SkillVerdict {
  skill: string;
  /** False when the window gave no opportunity for the skill: not scored. */
  opportunity: boolean;
  /** Codes that survived validation. */
  observed: string[];
  notApplicable: string[];
  level: FhsLevel | null;
  /**
   * The accepted ticks with the line each cites and its quote, for callers
   * that show evidence (helpline QA). Never persisted by the cut or benchmark
   * writers — `storedJudgement` keeps codes only.
   */
  evidence?: { code: string; line: string; quote: string }[];
}

export function deriveLevel(
  skill: FhsSkill,
  observed: ReadonlySet<string>,
  notApplicable: ReadonlySet<string>,
): FhsLevel {
  if (skill.unhelpful.some((b) => observed.has(b.code))) return 1;
  const required = skill.basic.filter(
    (b) => !(b.conditional && notApplicable.has(b.code)),
  );
  if (!required.every((b) => observed.has(b.code))) return 2;
  return skill.advanced.some((b) => observed.has(b.code)) ? 4 : 3;
}

/** Mean of the assessed skills' levels, 2dp; null when nothing was assessable. */
export function compositeOf(verdicts: readonly SkillVerdict[]): number | null {
  const levels = verdicts
    .map((v) => v.level)
    .filter((l): l is FhsLevel => l !== null);
  if (levels.length === 0) return null;
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  return Math.round(mean * 100) / 100;
}

/**
 * The persisted form of a judgement, shared by the cut and benchmark writers so
 * the two tables can never store the same verdicts differently: every skill's
 * verdict (behaviour codes and derived level), and `skillLevels` holding ONLY
 * the skills that had an opportunity — an absent key means "not assessable
 * here", never a low score.
 */
export function storedJudgement(verdicts: readonly SkillVerdict[]): {
  verdicts: StoredSkillVerdict[];
  skillLevels: Record<string, number>;
} {
  return {
    verdicts: verdicts.map((v) => ({
      skill: v.skill,
      opportunity: v.opportunity,
      level: v.level,
      observed: v.observed,
      notApplicable: v.notApplicable,
    })),
    skillLevels: Object.fromEntries(
      verdicts
        .filter((v) => v.level !== null)
        .map((v) => [v.skill, v.level as number]),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Judge-output validation
// ─────────────────────────────────────────────────────────────────────────────

/** A transcript line as the judge sees it: `H3` is the helper's 3rd line. */
export interface NumberedLine {
  id: string;
  speaker: 'helper' | 'client';
  text: string;
  /** False for context lines shown before the scored window. */
  scored: boolean;
}

export interface RawObservation {
  code?: unknown;
  line?: unknown;
  quote?: unknown;
}

export interface RawSkillJudgement {
  skill?: unknown;
  opportunity?: unknown;
  observed?: unknown;
  notApplicable?: unknown;
}

export interface ValidationStats {
  /** Ticks dropped because the code, line or quote did not check out. */
  droppedTicks: number;
  /** Skills the judge omitted or returned malformed; treated as not assessed. */
  missingSkills: number;
}

/**
 * Lower-cased, punctuation-light, whitespace-collapsed form for quote matching.
 * Speech-to-text punctuation is unstable and models tidy it when quoting, so an
 * exact match would reject honest quotes; letters and marks must still match.
 * `\p{M}` is kept on purpose — Devanagari and Tamil vowel signs are marks, and
 * stripping them would let a different word match.
 */
export function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

const MIN_QUOTE_CHARS = 3;

/**
 * Turn the judge's JSON into verdicts, keeping only what the transcript backs.
 *
 * A tick survives only if its code belongs to the skill, it cites a real line,
 * that line is inside the scored window, the line's speaker is right for the
 * behaviour (helper for anything the helper did; client for an `absence`
 * behaviour, whose evidence is the cue the helper failed to act on), and the
 * quote actually occurs in that line. This is the guard against a judge that
 * invents evidence: a fabricated quote costs the tick, it never earns one.
 */
export function validateJudgement(
  rawSkills: unknown,
  lines: readonly NumberedLine[],
): { verdicts: SkillVerdict[]; stats: ValidationStats } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const rawList = Array.isArray(rawSkills)
    ? (rawSkills as RawSkillJudgement[])
    : [];
  const rawBySkill = new Map<string, RawSkillJudgement>();
  for (const raw of rawList) {
    const key = typeof raw?.skill === 'string' ? raw.skill.trim() : '';
    if (key && !rawBySkill.has(key)) rawBySkill.set(key, raw);
  }

  const stats: ValidationStats = { droppedTicks: 0, missingSkills: 0 };
  const verdicts = FHS_RUBRIC.map((skill): SkillVerdict => {
    const raw = rawBySkill.get(skill.key);
    if (!raw || typeof raw.opportunity !== 'boolean') {
      stats.missingSkills += 1;
      return blank(skill.key);
    }
    if (!raw.opportunity) return blank(skill.key);

    const observed = new Set<string>();
    const evidence: { code: string; line: string; quote: string }[] = [];
    for (const obs of asArray<RawObservation>(raw.observed)) {
      if (acceptObservation(skill, obs, byId)) {
        observed.add(String(obs.code));
        evidence.push({
          code: String(obs.code),
          line: String(obs.line).trim(),
          quote: String(obs.quote),
        });
      } else {
        stats.droppedTicks += 1;
      }
    }

    const notApplicable = new Set(
      asArray<unknown>(raw.notApplicable)
        .map(String)
        .filter((code) => {
          const b = FHS_BEHAVIOURS_BY_CODE.get(code);
          // Only a conditional basic of THIS skill may be waived, and never
          // one the judge also claims to have seen.
          return (
            b?.skill === skill.key &&
            b.kind === 'basic' &&
            b.conditional === true &&
            !observed.has(code)
          );
        }),
    );

    return {
      skill: skill.key,
      opportunity: true,
      observed: [...observed].sort(),
      notApplicable: [...notApplicable].sort(),
      level: deriveLevel(skill, observed, notApplicable),
      evidence,
    };
  });

  return { verdicts, stats };
}

function acceptObservation(
  skill: FhsSkill,
  obs: RawObservation,
  byId: Map<string, NumberedLine>,
): boolean {
  const code = typeof obs?.code === 'string' ? obs.code : '';
  const behaviour = FHS_BEHAVIOURS_BY_CODE.get(code);
  if (!behaviour || behaviour.skill !== skill.key) return false;

  const line =
    typeof obs.line === 'string' ? byId.get(obs.line.trim()) : undefined;
  if (!line || !line.scored) return false;

  const expectedSpeaker = behaviour.absence ? 'client' : 'helper';
  if (line.speaker !== expectedSpeaker) return false;

  const quote =
    typeof obs.quote === 'string' ? normaliseForMatch(obs.quote) : '';
  if (quote.length < MIN_QUOTE_CHARS) return false;
  return normaliseForMatch(line.text).includes(quote);
}

function blank(skill: string): SkillVerdict {
  return {
    skill,
    opportunity: false,
    observed: [],
    notApplicable: [],
    level: null,
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Pull the first JSON object out of a model reply. `jsonMode` asks every
 * provider for a bare object, but none of them enforces a schema, and a fenced
 * block still turns up often enough to be worth one fallback.
 */
export function parseJudgeReply(text: string): Record<string, unknown> | null {
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const direct = attempt(trimmed);
  if (direct) return direct;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start
    ? attempt(trimmed.slice(start, end + 1))
    : null;
}
