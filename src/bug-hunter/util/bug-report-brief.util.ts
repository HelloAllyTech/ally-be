import { BugFindingSeverity } from '../enum/bug-finding.enum';

/**
 * The structured half of a staff bug report, and how it becomes the brief
 * Bug Hunter reads.
 *
 * The admin "Report a bug" form asks three things (what happened, what you
 * expected, where you saw it) and offers a few more behind "Add details".
 * Everything the pipeline reads — the repo classifier, the miss classifier,
 * the fix brief, the Verifier — reads the finding's `description`, so the
 * answers are folded into one plain-text brief here rather than taught to
 * each reader separately. The raw answers also stay on the reporter context
 * for the drawer.
 */

/** Where the reporter saw it, in product words; the repo is derived, never asked of staff. */
export const BUG_REPORT_SURFACES = [
  'helpline_web',
  'admin',
  'mobile',
  'voice_roleplay',
  'whatsapp',
  'not_sure',
] as const;
export type BugReportSurface = (typeof BUG_REPORT_SURFACES)[number];

export const BUG_REPORT_SURFACE_LABELS: Record<BugReportSurface, string> = {
  helpline_web: 'Helpline web app',
  admin: 'Admin dashboard',
  mobile: 'Mobile app',
  voice_roleplay: 'Voice roleplay',
  whatsapp: 'WhatsApp bot',
  not_sure: 'Not sure',
};

/** The repo a surface's bug almost always lives in. `null` leaves it to the classifier. */
export const BUG_REPORT_SURFACE_REPO: Record<BugReportSurface, string | null> =
  {
    helpline_web: 'ally-web',
    admin: 'ally-web',
    mobile: 'ally-mobile',
    voice_roleplay: 'ally-ai-learn',
    whatsapp: 'ally-be',
    not_sure: null,
  };

export const BUG_REPORT_FREQUENCIES = [
  'every_time',
  'sometimes',
  'once',
] as const;
export type BugReportFrequency = (typeof BUG_REPORT_FREQUENCIES)[number];
export const BUG_REPORT_FREQUENCY_LABELS: Record<BugReportFrequency, string> = {
  every_time: 'every time',
  sometimes: 'sometimes',
  once: 'once so far',
};

export const BUG_REPORT_IMPACTS = ['blocks', 'wrong', 'cosmetic'] as const;
export type BugReportImpact = (typeof BUG_REPORT_IMPACTS)[number];
export const BUG_REPORT_IMPACT_LABELS: Record<BugReportImpact, string> = {
  blocks: 'blocks my work',
  wrong: 'gives a wrong result',
  cosmetic: 'looks wrong',
};

/** A person's impact rating is a better severity than a model's guess. */
export const BUG_REPORT_IMPACT_SEVERITY: Record<
  BugReportImpact,
  BugFindingSeverity
> = {
  blocks: BugFindingSeverity.HIGH,
  wrong: BugFindingSeverity.MEDIUM,
  cosmetic: BugFindingSeverity.LOW,
};

/** The structured answers a report may carry, all optional; unknown values are ignored, not trusted. */
export interface BugReportStructuredContext {
  expected?: string;
  steps?: string;
  surface?: string;
  happenedAt?: string;
  frequency?: string;
  impact?: string;
  identifiers?: string;
  language?: string;
  screen?: string;
}

export function repoForSurface(surface: unknown): string | null {
  return BUG_REPORT_SURFACES.includes(surface as never)
    ? BUG_REPORT_SURFACE_REPO[surface as BugReportSurface]
    : null;
}

export function severityForImpact(impact: unknown): BugFindingSeverity | null {
  return BUG_REPORT_IMPACTS.includes(impact as never)
    ? BUG_REPORT_IMPACT_SEVERITY[impact as BugReportImpact]
    : null;
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : null;
};

/**
 * One brief from the reporter's answers, within the roadmap row's length
 * limit. What happened comes first and keeps the most room; the rest is
 * labelled lines a reader or a model can scan. Nothing the reporter did not
 * say is added.
 */
export function composeBugReportDescription(
  whatHappened: string,
  context: BugReportStructuredContext | null | undefined,
  max: number,
): string {
  const happened = whatHappened.trim();
  if (!context) return happened.slice(0, max);

  const lines: string[] = [];
  const expected = clean(context.expected, 400);
  if (expected) lines.push(`Expected: ${expected}`);
  const steps = clean(context.steps, 700);
  if (steps) lines.push(`Steps: ${steps}`);
  const surface = BUG_REPORT_SURFACES.includes(context.surface as never)
    ? BUG_REPORT_SURFACE_LABELS[context.surface as BugReportSurface]
    : null;
  const screen = clean(context.screen, 160);
  if (surface && surface !== BUG_REPORT_SURFACE_LABELS.not_sure) {
    lines.push(`Where: ${surface}${screen ? `, reported from ${screen}` : ''}`);
  } else if (screen) {
    lines.push(`Reported from: ${screen}`);
  }
  const when = clean(context.happenedAt, 40);
  if (when) lines.push(`When: ${when}`);
  const frequency = BUG_REPORT_FREQUENCIES.includes(context.frequency as never)
    ? BUG_REPORT_FREQUENCY_LABELS[context.frequency as BugReportFrequency]
    : null;
  if (frequency) lines.push(`How often: ${frequency}`);
  const impact = BUG_REPORT_IMPACTS.includes(context.impact as never)
    ? BUG_REPORT_IMPACT_LABELS[context.impact as BugReportImpact]
    : null;
  if (impact) lines.push(`Impact: ${impact}`);
  const identifiers = clean(context.identifiers, 300);
  if (identifiers) lines.push(`Identifiers: ${identifiers}`);
  const language = clean(context.language, 20);
  if (language) lines.push(`Language: ${language}`);

  if (!lines.length) return happened.slice(0, max);
  const tail = `\n\n${lines.join('\n')}`;
  // The reporter's own words give way last: trim the labelled lines before them.
  let body = happened;
  let out = `${body}${tail}`;
  if (out.length > max) {
    const roomForBody = Math.max(200, max - tail.length);
    body =
      happened.length > roomForBody
        ? `${happened.slice(0, roomForBody - 1)}…`
        : happened;
    out = `${body}${tail}`;
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
