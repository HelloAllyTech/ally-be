import { v4 as uuidv4 } from 'uuid';
import { BUILDER_REPO_NAMES } from '../constants/builder-repos.constants';
import { BuilderDiscovery } from './builder-discovery.util';

/**
 * The situation brief (W4): Builder's first visible turn in an interview.
 *
 * What exists (cited), what of the ask is already met, a reuse / extend / new
 * proposal per part, and the repos it touches — each a line the admin
 * confirms or corrects. The debrief interview redone under the plan took one
 * brief and two decisions where v8 took nine questions and three corrections;
 * this is that brief, held to the evidence: a line about what exists must cite
 * a lookup that found it.
 */

export type BuilderBriefLineKind =
  | 'exists'
  | 'alreadyMet'
  | 'proposal'
  | 'repo';
export type BuilderBriefApproach = 'reuse' | 'extend' | 'new';

export interface BuilderBriefCitation {
  /** `E3` for a discovery result, otherwise the source as the model gave it. */
  ref: string;
  /** What the admin reads: `docs_search "skill experiments" — ally-be:docs/skill-experiments.md`. */
  label: string;
}

export interface BuilderBriefLine {
  /** X1… exists, M1… already met, P1… proposals, R1… repos. */
  id: string;
  kind: BuilderBriefLineKind;
  text: string;
  cites: BuilderBriefCitation[];
  /** Proposals: which part of the ask, and how. */
  part?: string;
  approach?: BuilderBriefApproach;
  /** Repo lines. */
  repo?: string;
}

export interface BuilderSituationBrief {
  id: string;
  /** The text above the card. */
  message: string;
  lines: BuilderBriefLine[];
  createdAt: string;
}

export type BuilderBriefVerdict = 'confirm' | 'correct';

export interface BuilderBriefResponse {
  briefId: string;
  lines: { id: string; verdict: BuilderBriefVerdict; correction?: string }[];
  note?: string;
}

const CITES = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Discovery refs (E1, E2…) or the path of a file you read this session. A line about ' +
    'what exists with no citation is sent back.',
};

export const SUBMIT_SITUATION_BRIEF_TOOL = {
  name: 'submit_situation_brief',
  description:
    "Your first visible turn in this interview: what the platform already has that the admin's " +
    'request touches, and what you propose. The admin confirms or corrects each line, and the ' +
    'interview goes on from what they settle. Cite discovery refs (E1…) for everything you say ' +
    'exists. Call it on its own, after you have read every result. This ends your turn; ' +
    '`message` is the text above the card.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'One or two sentences: what you understood they want, and that the brief below is ' +
          'what you found — the only prose the admin sees this turn.',
      },
      exists: {
        type: 'array',
        description:
          'What already exists that this touches, reuses or duplicates — one line each, named ' +
          'the way the product names it.',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, cites: CITES },
          required: ['text', 'cites'],
        },
      },
      alreadyMet: {
        type: 'array',
        description:
          'Parts of the request the platform already does today. Leave empty if none.',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, cites: CITES },
          required: ['text', 'cites'],
        },
      },
      proposals: {
        type: 'array',
        description:
          'One line per part of the request: reuse what exists, extend it, or build new. ' +
          'Reuse and extend cite what they build on; new says why nothing existing fits.',
        items: {
          type: 'object',
          properties: {
            part: { type: 'string', description: 'The part of the request' },
            approach: { type: 'string', enum: ['reuse', 'extend', 'new'] },
            text: { type: 'string' },
            cites: CITES,
          },
          required: ['part', 'approach', 'text'],
        },
      },
      repos: {
        type: 'array',
        description:
          'Every repo the work lands in, with why — a learner surface on web usually has a ' +
          'mobile twin.',
        items: {
          type: 'object',
          properties: {
            repo: { type: 'string', enum: BUILDER_REPO_NAMES },
            why: { type: 'string' },
          },
          required: ['repo', 'why'],
        },
      },
    },
    required: ['message', 'exists', 'proposals', 'repos'],
  },
};

const clip = (value: unknown, max: number): string => {
  const flat = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const asList = (value: unknown): Record<string, any>[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, any> =>
          !!entry && typeof entry === 'object',
      )
    : [];

const asStrings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);

/** Sources a citation can rest on besides a discovery ref: lookups that succeeded this session. */
export interface BuilderBriefEvidence {
  discovery: BuilderDiscovery | null;
  /** Sources and findings of successful lookups (evidence log + this turn). */
  sources: string[];
}

/**
 * Resolve one citation: a discovery ref that succeeded, or a source a
 * successful lookup this session named. Null when it rests on nothing.
 */
export function resolveCitation(
  cite: string,
  evidence: BuilderBriefEvidence,
): BuilderBriefCitation | null {
  const ref = cite.trim();
  const match = /^E(\d+)$/i.exec(ref);
  if (match) {
    const item = evidence.discovery?.items.find(
      (entry) => entry.ref.toUpperCase() === ref.toUpperCase(),
    );
    if (!item || !item.ok || !item.found.length) return null;
    // What was found, not how: the admin is checking the claim against its
    // source, and the tool and query that surfaced it are plumbing.
    return { ref: item.ref, label: clip(item.found[0], 200) };
  }
  const needle = ref.toLowerCase().replace(/^\/+/, '');
  if (needle.length < 4) return null;
  const hit = evidence.sources.find((source) =>
    source.toLowerCase().includes(needle),
  );
  return hit ? { ref, label: clip(ref, 160) } : null;
}

/**
 * The brief as the model submitted it, made whole: line ids assigned, every
 * citation resolved, and what is wrong with it said once per problem — the
 * validated turn sends it back with these, as it does any reply.
 */
/** A reason the brief is sent back, phrased for each reader, keyed so it blocks once. */
export interface BuilderBriefProblem {
  key: string;
  toModel: string;
  toAdmin: string;
}

export function normaliseSituationBrief(
  input: Record<string, any>,
  evidence: BuilderBriefEvidence,
): { brief: BuilderSituationBrief; problems: BuilderBriefProblem[] } {
  const problems: BuilderBriefProblem[] = [];
  const uncited: string[] = [];
  const lines: BuilderBriefLine[] = [];
  const unresolved: string[] = [];

  const cited = (raw: unknown): BuilderBriefCitation[] => {
    const cites: BuilderBriefCitation[] = [];
    for (const cite of asStrings(raw)) {
      const resolved = resolveCitation(cite, evidence);
      if (!resolved) unresolved.push(cite);
      // Three searches that found the same thing are one source.
      else if (!cites.some((existing) => existing.label === resolved.label)) {
        cites.push(resolved);
      }
    }
    return cites;
  };

  asList(input.exists).forEach((entry, index) => {
    const text = clip(entry.text, 400);
    if (!text) return;
    const cites = cited(entry.cites);
    if (!cites.length) uncited.push(text);
    lines.push({ id: `X${index + 1}`, kind: 'exists', text, cites });
  });

  asList(input.alreadyMet).forEach((entry, index) => {
    const text = clip(entry.text, 400);
    if (!text) return;
    const cites = cited(entry.cites);
    if (!cites.length) uncited.push(text);
    lines.push({ id: `M${index + 1}`, kind: 'alreadyMet', text, cites });
  });

  asList(input.proposals).forEach((entry, index) => {
    const text = clip(entry.text, 400);
    const part = clip(entry.part, 120);
    if (!text && !part) return;
    const approach = (['reuse', 'extend', 'new'] as const).find(
      (value) =>
        value ===
        String(entry.approach ?? '')
          .trim()
          .toLowerCase(),
    );
    if (!approach) {
      problems.push({
        key: 'brief_approach',
        toModel: `The proposal for "${clip(part || text, 60)}" needs an approach: reuse, extend or new.`,
        toAdmin:
          'A proposal in the brief does not say whether it reuses, extends or builds new.',
      });
    }
    const cites = cited(entry.cites);
    if ((approach === 'reuse' || approach === 'extend') && !cites.length) {
      uncited.push(`${approach}: ${part || text}`);
    }
    lines.push({
      id: `P${index + 1}`,
      kind: 'proposal',
      text: text || part,
      cites,
      ...(part ? { part } : {}),
      ...(approach ? { approach } : {}),
    });
  });

  const repos = new Set<string>();
  asList(input.repos).forEach((entry) => {
    const repo = String(entry.repo ?? '').trim();
    if (!BUILDER_REPO_NAMES.includes(repo) || repos.has(repo)) return;
    repos.add(repo);
    lines.push({
      id: `R${repos.size}`,
      kind: 'repo',
      repo,
      text: clip(entry.why, 300) || repo,
      cites: [],
    });
  });

  if (uncited.length) {
    problems.push({
      key: 'brief_uncited',
      toModel:
        `These lines say something exists, is met or can be built on, and cite no lookup ` +
        `that found it: ${uncited
          .slice(0, 6)
          .map((text) => `"${clip(text, 80)}"`)
          .join(
            ', ',
          )}. Cite the discovery ref (E…) or a file you read — or, if nothing ` +
        'found it, leave the line out.',
      toAdmin: `${uncited.length} line(s) of the brief cite no lookup that found them.`,
    });
  }
  if (unresolved.length) {
    problems.push({
      key: 'brief_unresolved',
      toModel: `These citations match no lookup that succeeded this session: ${unresolved
        .slice(0, 6)
        .map((cite) => `"${clip(cite, 60)}"`)
        .join(
          ', ',
        )}. Cite discovery refs as E1, E2…, or the path of a file you read.`,
      toAdmin: "Some of the brief's citations match nothing Builder looked up.",
    });
  }
  if (!lines.some((line) => line.kind === 'proposal')) {
    problems.push({
      key: 'brief_no_proposal',
      toModel:
        'The brief has no proposal. Say, per part of the request, whether you would reuse, ' +
        'extend or build new.',
      toAdmin: 'The brief proposes nothing.',
    });
  }
  if (!repos.size) {
    problems.push({
      key: 'brief_no_repo',
      toModel: 'The brief names no repo the work lands in.',
      toAdmin: 'The brief names no repo.',
    });
  }
  const message = clip(input.message, 1_000);
  if (!message) {
    problems.push({
      key: 'brief_no_message',
      toModel: 'The brief needs a message — the text the admin reads above it.',
      toAdmin: 'The brief came without a message.',
    });
  }

  return {
    brief: {
      id: uuidv4(),
      message,
      lines,
      createdAt: new Date().toISOString(),
    },
    problems,
  };
}

/** A brief off a stored row, or null. */
export function storedSituationBrief(
  metadata: Record<string, any> | null | undefined,
): BuilderSituationBrief | null {
  const brief = metadata?.situationBrief;
  return brief &&
    typeof brief === 'object' &&
    typeof brief.id === 'string' &&
    Array.isArray(brief.lines)
    ? (brief as BuilderSituationBrief)
    : null;
}

/** The admin's response, made safe: known lines only, corrections need words. */
export function normaliseBriefResponse(
  brief: BuilderSituationBrief | null,
  raw: Record<string, any> | null | undefined,
): BuilderBriefResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const known = new Set((brief?.lines ?? []).map((line) => line.id));
  const lines = asList(raw.lines)
    .map((entry) => {
      const id = String(entry.id ?? '').trim();
      const correction = clip(entry.correction, 1_000);
      const verdict: BuilderBriefVerdict =
        entry.verdict === 'correct' && correction ? 'correct' : 'confirm';
      return {
        id,
        verdict,
        ...(verdict === 'correct' ? { correction } : {}),
      };
    })
    .filter((entry) => entry.id && (!brief || known.has(entry.id)));
  const note = clip(raw.note, 2_000);
  return {
    briefId: String(raw.briefId ?? brief?.id ?? ''),
    lines,
    ...(note ? { note } : {}),
  };
}

/**
 * The response as the admin's message: deterministic, so the model, the
 * transcript and the learning loop all read the same thing. Corrections are
 * quoted in full with the line they correct.
 */
export function renderBriefResponse(
  brief: BuilderSituationBrief | null,
  response: BuilderBriefResponse,
): string {
  const lineOf = new Map((brief?.lines ?? []).map((line) => [line.id, line]));
  const confirmed = response.lines
    .filter((line) => line.verdict === 'confirm')
    .map((line) => line.id);
  const corrected = response.lines.filter((line) => line.verdict === 'correct');
  const unanswered = (brief?.lines ?? [])
    .map((line) => line.id)
    .filter((id) => !response.lines.some((line) => line.id === id));
  return [
    `[responds to situation brief ${response.briefId}]`,
    confirmed.length ? `Confirmed: ${confirmed.join(', ')}.` : '',
    ...corrected.map((line) => {
      const original = lineOf.get(line.id);
      return `Corrected ${line.id}${
        original ? ` ("${clip(original.text, 120)}")` : ''
      }: ${line.correction}`;
    }),
    unanswered.length ? `Not answered: ${unanswered.join(', ')}.` : '',
    response.note ? `Also: ${response.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The brief as the model reads it on the turn that answers it. */
export function renderBriefForModel(
  brief: BuilderSituationBrief,
  response?: BuilderBriefResponse | null,
): string {
  const verdictOf = new Map(
    (response?.lines ?? []).map((line) => [line.id, line]),
  );
  return [
    '<situation_brief>',
    ...brief.lines.map((line) => {
      const verdict = verdictOf.get(line.id);
      const status = !verdict
        ? response
          ? ' [not answered]'
          : ''
        : verdict.verdict === 'confirm'
          ? ' [CONFIRMED]'
          : ` [CORRECTED: ${verdict.correction}]`;
      const head =
        line.kind === 'proposal'
          ? `${line.id} proposal (${line.approach ?? '?'}) ${line.part ?? ''}:`
          : line.kind === 'repo'
            ? `${line.id} repo ${line.repo}:`
            : `${line.id} ${line.kind === 'exists' ? 'exists' : 'already met'}:`;
      return `${head} ${line.text}${status}`;
    }),
    '</situation_brief>',
    response
      ? 'Write what the admin confirmed into the PRD and apply every correction — a corrected ' +
        'line is what they want instead. Do not ask again about anything they confirmed.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
