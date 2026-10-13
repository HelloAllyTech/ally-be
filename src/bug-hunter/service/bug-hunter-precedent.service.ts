import { Injectable } from '@nestjs/common';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { faultLocationOf } from '../type/bug-finding-verdict.type';
import { wrongFixOf } from '../type/bug-wrong-fix.type';

/** A resolved or decided bug that reads like the one at hand, and how it ended. */
export interface BugPrecedent {
  id: string;
  title: string;
  repo: string | null;
  status: string;
  prUrl: string | null;
  /** Where the Verifier located its fault, when it did. */
  fault: { layer: string; repo: string | null; repair: string | null } | null;
  /** When its fix turned out wrong: which link broke and why. */
  wrongFix: { link: string; reason: string } | null;
  /** Why a person declined it, when they did. */
  declined: string | null;
}

/** Statuses whose ending says something: shipped, declined, stopped, or waiting on review. */
const INFORMATIVE: BugFindingStatus[] = [
  BugFindingStatus.MERGED,
  BugFindingStatus.RELEASED,
  BugFindingStatus.REJECTED,
  BugFindingStatus.DISMISSED,
  BugFindingStatus.CANCELLED,
  BugFindingStatus.PR_OPENED,
];

const STOPWORDS = new Set(
  'about after again also because been being before below between both cannot could does doing down during each from further have having here into itself just more most other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your yours issue should every still shows show shown user users when page screen select selected open opens'.split(
    ' ',
  ),
);

/**
 * The words that carry a bug's meaning, for a Postgres OR query: at least four
 * letters, no stopwords, most frequent first, at most twelve. Exported for
 * the test; the query is only as good as these.
 */
export function precedentKeywords(text: string, max = 12): string[] {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

/**
 * Bugs like this one, before: the cheapest memory Bug Hunter has. Two
 * reports about untranslated content in one week (a tooltip, then simulation
 * titles) were each studied from scratch; the second's study would have
 * started from the first's located fault. Full-text rank over title and
 * description, no embedding and no extra table, so it costs one query.
 */
@Injectable()
export class BugHunterPrecedentService {
  constructor(private readonly findingRepository: BugFindingRepository) {}

  async similar(
    finding: Pick<BugFinding, 'id' | 'title' | 'description'>,
    limit = 3,
  ): Promise<BugPrecedent[]> {
    const words = precedentKeywords(
      `${finding.title} ${finding.title} ${finding.description}`,
    );
    if (words.length < 2) return [];
    const rows = await this.findingRepository
      .createQueryBuilder('f')
      .where('f.id <> :id', { id: finding.id })
      .andWhere('f.status IN (:...statuses)', { statuses: INFORMATIVE })
      .andWhere(
        `to_tsvector('english', coalesce(f.title, '') || ' ' || coalesce(f.description, '')) @@ to_tsquery('english', :q)`,
        { q: words.join(' | ') },
      )
      .orderBy(
        `ts_rank(to_tsvector('english', coalesce(f.title, '') || ' ' || coalesce(f.description, '')), to_tsquery('english', :q))`,
        'DESC',
      )
      .addOrderBy('f.createdAt', 'DESC')
      .limit(limit)
      .getMany();
    return rows.map(toPrecedent);
  }
}

export function toPrecedent(f: BugFinding): BugPrecedent {
  const fault = faultLocationOf(f.metadata);
  const wrong = wrongFixOf(f.metadata);
  return {
    id: f.id,
    title: f.title.length > 140 ? `${f.title.slice(0, 139)}…` : f.title,
    repo: f.repo ?? null,
    status: f.status,
    prUrl: f.prUrl ?? null,
    fault: fault
      ? { layer: fault.layer, repo: fault.repo, repair: fault.repair }
      : null,
    wrongFix: wrong ? { link: wrong.link, reason: wrong.reason } : null,
    declined:
      f.status === BugFindingStatus.REJECTED ||
      f.status === BugFindingStatus.DISMISSED
        ? [f.decisionReason, f.decisionNote].filter(Boolean).join(': ') || null
        : null,
  };
}

export const renderPrecedents = (precedents: BugPrecedent[]): string[] =>
  precedents.length
    ? [
        `## Bugs like this one, before`,
        `Resolved or decided bugs whose words match this one. Read how they ended before you decide where this fault is; a match in words is not proof of the same cause.`,
        ...precedents.map((p) =>
          [
            `- ${p.title} (${p.repo ?? 'no repo'}, ${p.status}${p.prUrl ? `, ${p.prUrl}` : ''})`,
            p.fault
              ? ` Fault located in ${p.fault.layer}${p.fault.repo ? ` (${p.fault.repo})` : ''}${p.fault.repair ? `; repair: ${p.fault.repair}` : ''}.`
              : '',
            p.wrongFix
              ? ` Its fix was WRONG at "${p.wrongFix.link}": ${p.wrongFix.reason}`
              : '',
            p.declined ? ` Declined: ${p.declined}.` : '',
          ].join(''),
        ),
        ``,
      ]
    : [];
