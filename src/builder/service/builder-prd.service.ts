import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { JsonPatchError, JsonPatchOp } from 'src/common/util/json-patch.util';
import { BuilderPrdDoc } from '../entity/builder-prd-doc.entity';
import { BuilderPrdVersion } from '../entity/builder-prd-version.entity';
import { BuilderPrdDocRepository } from '../repository/builder-prd.repository';
import { BuilderPrdVersionAuthor } from '../enum/builder.enum';
import {
  BUILDER_REPO_NAMES,
  isBuilderRepo,
} from '../constants/builder-repos.constants';
import {
  BuilderPrdDocument,
  BuilderPrdReadiness,
  BuilderPrdReadinessSection,
  BuilderPrdRepoPlan,
  BuilderReadinessSignals,
  BuilderTechnicalDesign,
  createEmptyPrdDocument,
} from '../type/builder-prd.type';
import {
  citedPathMatchesRead,
  citedPaths,
  mentionsId,
  mentionsIdentifier,
  reposATestPlanTouches,
  reposOwningALine,
} from '../util/builder-readiness-checks.util';
import {
  createPrdNormaliseDiagnostics,
  normalisePrdDocument,
  PrdNormaliseDiagnostics,
} from '../util/builder-prd-normalise.util';
import {
  applyPrdEdit,
  applyTolerantPrdPatch,
  PrdEdit,
  PrdEditError,
} from '../util/builder-prd-edits.util';

/**
 * One persisted PRD mutation: the new doc, its immutable snapshot, and what
 * normalisation had to coerce on the way in.
 */
export interface BuilderPrdMutationResult {
  doc: BuilderPrdDoc;
  version: BuilderPrdVersion;
  diagnostics: PrdNormaliseDiagnostics;
}

/** Prose sections that must say something before a build can start. */
const PROSE_SECTIONS: {
  key: keyof BuilderPrdDocument;
  label: string;
  minLength: number;
}[] = [
  { key: 'summary', label: 'Summary', minLength: 40 },
  { key: 'problem', label: 'Problem', minLength: 60 },
  { key: 'usersAndContext', label: 'Users & context', minLength: 40 },
  // Sits before Goals deliberately: what already exists is the thing that
  // decides which goals are worth having, and an agent that writes goals
  // first tends to defend them afterwards.
  { key: 'existingBehaviour', label: 'What already exists', minLength: 60 },
  // And straight after it, where the change belongs — because knowing what
  // exists is what makes that answerable, and because the repo where a
  // problem was noticed is evidence about where it was noticed and nothing
  // else.
  {
    key: 'whereChangesBelong',
    label: 'Where the change belongs',
    minLength: 60,
  },
  { key: 'goals', label: 'Goals', minLength: 30 },
  { key: 'nonGoals', label: 'Non-goals', minLength: 20 },
  { key: 'testPlanMd', label: 'Test plan', minLength: 100 },
  { key: 'e2ePlanMd', label: 'E2E test plan', minLength: 60 },
];

/**
 * The PRD living document: read, patch, snapshot, and score.
 *
 * Mutation goes through one primitive (persistDraftMutation) whichever side
 * it came from — the agent's update_prd tool or an admin's section edit — so
 * the version trail is complete by construction rather than by discipline.
 */
@Injectable()
export class BuilderPrdService {
  private readonly logger = LoggerService.getInstance(BuilderPrdService.name);

  constructor(
    private readonly docRepository: BuilderPrdDocRepository,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The session's PRD, created empty on first read. Lazily rather than at
   * session creation so a session row is never left half-built if the doc
   * insert fails.
   */
  async getOrCreateDoc(
    sessionId: string,
    userId: number,
    title?: string,
  ): Promise<BuilderPrdDoc> {
    const existing = await this.docRepository.findBySession(sessionId);
    if (existing) {
      // Normalised on the way out as well as on the way in: docs written
      // before the write-side guard existed still hold malformed fields, and a
      // session whose panel crashes on open cannot be repaired by editing it.
      // In memory only — a read has no business writing a new version, and the
      // next real patch persists the clean shape anyway. Every reader (the
      // admin panel, the readiness rubric, the interview and build prompts)
      // comes through here, so this is the one place that covers them all.
      existing.draft = normalisePrdDocument(existing.draft);
      return existing;
    }
    return this.docRepository.save(
      this.docRepository.create({
        sessionId,
        draft: createEmptyPrdDocument(title),
        versionNumber: 0,
        updatedBy: userId,
      }),
    );
  }

  /**
   * Apply RFC-6902 ops to the draft and persist the result.
   *
   * Patch failures are thrown as BadRequestException carrying the failing op
   * index, because both callers can act on that: the agent self-repairs from
   * the message, and the admin UI shows which section rejected the edit.
   */
  async applyPatch(
    doc: BuilderPrdDoc,
    ops: JsonPatchOp[],
    userId: number,
    author: BuilderPrdVersionAuthor,
    changeSummary?: string,
  ): Promise<BuilderPrdMutationResult> {
    // The technical design is not the interviewer's or the admin editor's to
    // write. It is drafted by a designer run with the code checked out and
    // approved by a person; a patch that could edit it would let an approved
    // design say something nobody approved, and the build is held to it.
    // Refused rather than silently dropped, so the writer knows.
    const designOp = (Array.isArray(ops) ? ops : []).findIndex((op) =>
      String(op?.path ?? '').startsWith('/technicalDesign'),
    );
    if (designOp >= 0) {
      throw new BadRequestException(
        `PRD patch failed at operation ${designOp}: /technicalDesign cannot be edited ` +
          'here. The technical design is drafted by the designer run and approved ' +
          'from the PRD panel — change the PRD and redraft it instead.',
      );
    }

    // Fail fast against the caller's already-loaded draft so an obviously bad
    // patch (unknown path, etc.) never opens a transaction. The authoritative
    // application happens inside persistDraftMutation against whatever draft
    // is current at write time.
    try {
      applyTolerantPrdPatch(doc.draft, ops);
    } catch (error) {
      if (error instanceof JsonPatchError) {
        throw new BadRequestException(
          `PRD patch failed at operation ${error.opIndex ?? 0}: ${error.message}`,
        );
      }
      throw error;
    }
    return this.persistDraftMutation(doc, ops, userId, author, changeSummary);
  }

  /**
   * Apply one id-addressed edit (a requirement by id, a repo plan by repo
   * name, a section by key) and persist it.
   *
   * Resolved against the draft read inside the write transaction, not the
   * caller's copy — so an entry cannot have moved between the agent reading
   * the document and its edit landing, which is the failure positions had.
   * Fails the same way `applyPatch` does, as a BadRequestException the agent
   * can repair from.
   */
  async applyEdit(
    doc: BuilderPrdDoc,
    edit: PrdEdit,
    userId: number,
    author: BuilderPrdVersionAuthor,
    changeSummary?: string,
  ): Promise<BuilderPrdMutationResult> {
    const apply = (draft: BuilderPrdDocument): BuilderPrdDocument => {
      try {
        return applyPrdEdit(draft, edit);
      } catch (error) {
        if (error instanceof PrdEditError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    };
    // Fail fast on the loaded draft, as applyPatch does, before a transaction.
    apply(doc.draft);
    return this.persistMutation(
      doc,
      (current) => ({
        ...apply(current),
        technicalDesign: current.technicalDesign ?? null,
      }),
      userId,
      author,
      changeSummary,
    );
  }

  /**
   * Replace the technical design, the one write path that may.
   *
   * Goes through the same transaction and version trail as every other
   * mutation, so a design submission, a failure and an approval each leave a
   * snapshot — the record of what was approved is the PRD version it was
   * approved in.
   */
  async setTechnicalDesign(
    doc: BuilderPrdDoc,
    design: BuilderTechnicalDesign | null,
    userId: number,
    author: BuilderPrdVersionAuthor,
    changeSummary?: string,
  ): Promise<BuilderPrdMutationResult> {
    return this.persistMutation(
      doc,
      (current) => ({ ...current, technicalDesign: design }),
      userId,
      author,
      changeSummary,
    );
  }

  /**
   * Write the draft and append an immutable snapshot in one transaction,
   * retrying on a versionNumber race (two writers landing together — the
   * agent patching while the admin saves a section edit).
   *
   * The ops are re-applied to the freshly-read draft on every attempt, not
   * just the first: recomputing nextVersionNumber from `current` while still
   * writing content derived from the pre-race draft would silently discard
   * whichever write committed first, defeating the retry.
   */
  async persistDraftMutation(
    doc: BuilderPrdDoc,
    ops: JsonPatchOp[],
    userId: number,
    author: BuilderPrdVersionAuthor,
    changeSummary?: string,
  ): Promise<BuilderPrdMutationResult> {
    return this.persistMutation(
      doc,
      (current) => {
        let next: BuilderPrdDocument;
        try {
          next = applyTolerantPrdPatch(current, ops);
        } catch (error) {
          if (error instanceof JsonPatchError) {
            throw new BadRequestException(
              `PRD patch failed at operation ${error.opIndex ?? 0}: ${error.message}`,
            );
          }
          throw error;
        }
        // Whatever the ops did at the root, the design is carried over from
        // the stored draft. applyPatch refuses ops addressed to it; this is
        // what stops a whole-document replace from doing the same thing by
        // the back door.
        return { ...next, technicalDesign: current.technicalDesign ?? null };
      },
      userId,
      author,
      changeSummary,
    );
  }

  private async persistMutation(
    doc: BuilderPrdDoc,
    mutate: (current: BuilderPrdDocument) => BuilderPrdDocument,
    userId: number,
    author: BuilderPrdVersionAuthor,
    changeSummary?: string,
  ): Promise<BuilderPrdMutationResult> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.dataSource.transaction(async (em) => {
          const docRepo = em.getRepository(BuilderPrdDoc);
          const versionRepo = em.getRepository(BuilderPrdVersion);

          // Re-read inside the transaction: versionNumber — and the draft
          // itself — may have moved since the caller loaded the doc.
          const current = await docRepo.findOneOrFail({
            where: { id: doc.id },
          });
          const nextVersionNumber = current.versionNumber + 1;

          const nextDraft = mutate(current.draft);

          // Every write goes through here, so this is the one place that can
          // promise the stored document matches its declared shape — the
          // agent's patch `value` is untyped and has written objects where
          // the schema says string.
          //
          // The diagnostics are collected rather than discarded because the
          // writer is usually the interview agent, and what normalisation
          // had to do is the only signal it gets that a key name it invented
          // was not the one stored.
          const diagnostics = createPrdNormaliseDiagnostics();
          const normalised = normalisePrdDocument(nextDraft, diagnostics);

          const version = await versionRepo.save(
            versionRepo.create({
              docId: current.id,
              versionNumber: nextVersionNumber,
              content: normalised,
              author,
              changeSummary: changeSummary ?? null,
              createdBy: userId,
            }),
          );

          await docRepo.update(current.id, {
            draft: normalised,
            versionNumber: nextVersionNumber,
            updatedBy: userId,
          });
          const saved = await docRepo.findOneOrFail({
            where: { id: current.id },
          });
          return { doc: saved, version, diagnostics };
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && this.isDuplicateKey(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  private isDuplicateKey(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    return code === '23505';
  }

  /**
   * Score the PRD against the build-readiness rubric.
   *
   * The rubric is deliberately about *decidability*, not length: a build can
   * start when nothing material is still open. Unconfirmed assumptions and
   * open questions are hard blockers because both mean the agent is about to
   * guess, and a guess discovered at PR-review time has already cost a full
   * build.
   */
  computeReadiness(
    draft: BuilderPrdDocument,
    signals: BuilderReadinessSignals = {},
  ): BuilderPrdReadiness {
    const sections: BuilderPrdReadinessSection[] = [];

    for (const { key, label, minLength } of PROSE_SECTIONS) {
      const value = String((draft as Record<string, any>)[key] ?? '').trim();
      const ok = value.length >= minLength;
      sections.push({
        key: String(key),
        label,
        ok,
        hint: ok
          ? ''
          : value.length === 0
            ? `${label} is empty.`
            : `${label} is too thin to build from.`,
      });
    }

    const requirements = draft.requirements ?? [];
    // Names the requirement by id first — the handle the edit-by-id tools take
    // and the one that cannot shift — with the pointer after it for an
    // update_prd patch. "A requirement has no criteria" would send the agent
    // re-reading the whole array to find out which.
    const requirementsWithoutCriteria = requirements
      .map((requirement, index) => ({ requirement, index }))
      .filter(
        ({ requirement }) => !(requirement.acceptanceCriteria ?? []).length,
      );
    sections.push({
      key: 'requirements',
      label: 'Requirements',
      ok: requirements.length > 0 && requirementsWithoutCriteria.length === 0,
      hint: !requirements.length
        ? 'No requirements captured yet.'
        : requirementsWithoutCriteria.length
          ? `${requirementsWithoutCriteria.length} requirement(s) have no acceptance criteria.`
          : '',
      detail: !requirements.length
        ? 'Each /requirements entry is {id, title, description, ' +
          'acceptanceCriteria}, acceptanceCriteria being a list of plain ' +
          'sentences.'
        : requirementsWithoutCriteria.length
          ? 'Set "acceptanceCriteria" to a list of observable, testable ' +
            'sentences on: ' +
            requirementsWithoutCriteria
              .map(({ requirement, index }) => {
                const id = String(requirement.id ?? '').trim();
                const title = String(requirement.title ?? '').trim();
                return `${id || `requirement ${index + 1} (no id)`}${
                  title ? ` "${title}"` : ''
                } (/requirements/${index}/acceptanceCriteria)`;
              })
              .join(', ') +
            '.'
          : '',
    });

    const repoPlans = draft.technicalPlan?.repos ?? [];
    // Three ways a technical plan fails to be buildable, checked in the order
    // a reader would care about them. The unnamed-repo case is not
    // hypothetical: the agent adds a plan entry as soon as it knows a change
    // is needed, sometimes before it has settled which repo owns it, and a
    // plan naming no repo would otherwise pass as complete.
    const plansAt = (
      predicate: (plan: BuilderPrdRepoPlan) => boolean,
    ): { plan: BuilderPrdRepoPlan; index: number }[] =>
      repoPlans
        .map((plan, index) => ({ plan, index }))
        .filter(({ plan }) => predicate(plan));

    const unnamedRepoPlans = plansAt((plan) => !String(plan.repo ?? '').trim());
    const unknownRepoPlans = plansAt(
      (plan) => !!String(plan.repo ?? '').trim() && !isBuilderRepo(plan.repo),
    );
    const emptyRepoPlans = plansAt(
      (plan) =>
        !!String(plan.repo ?? '').trim() &&
        !String(plan.changesMd ?? '').trim(),
    );
    const repoChoices = BUILDER_REPO_NAMES.join(', ');
    const planShape =
      'Each /technicalPlan/repos entry is {repo, changesMd} and only those two ' +
      'keys are stored. One entry per repo the build touches — several entries ' +
      'describing the same change in different repos is the correct way to ' +
      'write a cross-repo feature, not a workaround.';

    sections.push({
      key: 'technicalPlan',
      label: 'Technical plan',
      ok:
        repoPlans.length > 0 &&
        unnamedRepoPlans.length === 0 &&
        unknownRepoPlans.length === 0 &&
        emptyRepoPlans.length === 0,
      hint: !repoPlans.length
        ? 'No repos picked yet — the build has nowhere to land.'
        : unnamedRepoPlans.length
          ? `${unnamedRepoPlans.length} planned change(s) have no repo chosen.`
          : unknownRepoPlans.length
            ? `Not repos Builder can work in: ${unknownRepoPlans
                .map(({ plan }) => plan.repo)
                .join(', ')}.`
            : emptyRepoPlans.length
              ? `No described changes for: ${emptyRepoPlans
                  .map(({ plan }) => plan.repo)
                  .join(', ')}.`
              : '',
      detail: !repoPlans.length
        ? `${planShape} "repo" must be one of: ${repoChoices}.`
        : unnamedRepoPlans.length
          ? `Name the repo of ${unnamedRepoPlans
              .map(
                ({ index }) =>
                  `plan entry ${index + 1} (/technicalPlan/repos/${index}/repo)`,
              )
              .join(', ')}, one of: ${repoChoices} — or remove the entry if ` +
            `which repo owns it is still open. ${planShape}`
          : unknownRepoPlans.length
            ? `Allowed values: ${repoChoices}. Fix ${unknownRepoPlans
                .map(
                  ({ plan, index }) =>
                    `"${plan.repo}" (/technicalPlan/repos/${index}/repo)`,
                )
                .join(', ')}.`
            : emptyRepoPlans.length
              ? 'Write what changes in that repo, in enough detail to start ' +
                'from, for: ' +
                emptyRepoPlans
                  .map(
                    ({ plan, index }) =>
                      `${plan.repo} (/technicalPlan/repos/${index}/changesMd)`,
                  )
                  .join(', ') +
                '.'
              : '',
    });

    // Everything pushed so far asks "is this written?" and earns score.
    // The two rows below ask "is anything outstanding?" and only ever block:
    // both pass vacuously on a blank PRD, so counting them would show a fresh
    // session at 20% and put green ticks against work nobody has done yet.
    const scoringSectionCount = sections.length;

    const unconfirmed = (draft.assumptions ?? []).filter(
      (assumption) => assumption.status !== 'confirmed',
    );
    sections.push({
      key: 'assumptions',
      label: 'Assumptions',
      ok: unconfirmed.length === 0,
      hint: unconfirmed.length
        ? `${unconfirmed.length} assumption(s) still unconfirmed.`
        : '',
    });

    const openQuestions = (draft.openQuestions ?? []).filter((question) =>
      String(question ?? '').trim(),
    );
    sections.push({
      key: 'openQuestions',
      label: 'Open questions',
      ok: openQuestions.length === 0,
      hint: openQuestions.length
        ? `${openQuestions.length} open question(s) left to settle.`
        : '',
    });

    // The one rubric row that compares two sections against each other.
    //
    // "Where the change belongs" is prose, and prose is not checkable — except
    // for the repo names in it, which come from a fixed list. That is enough
    // to catch the failure this whole section exists for: a PRD that has
    // traced the behaviour into ally-be and then plans only ally-web. The
    // build would clone one repo, fix what it could reach, and pass its own
    // gate against the half it changed.
    //
    // Blocks rather than scores, and passes vacuously on a blank PRD: naming
    // no repos is not a claim about any.
    //
    // Deliberately one-directional. A repo named in the prose must be planned;
    // a repo planned but not discussed in the prose is untidy, not wrong, and
    // blocking on it would turn a section about reasoning into a checklist to
    // satisfy.
    // Only a repo that OWNS a line counts — "- ally-be: the count is computed
    // here", not any mention anywhere in the prose. The looser reading was
    // written first and immediately flagged a sentence whose whole point was
    // that a repo is NOT involved ("nothing in ally-web renders them yet").
    // Naming a repo to rule it out is a normal, useful thing to write, and a
    // check that punishes it teaches people to stop writing it.
    const namedRepos = reposOwningALine(draft.whereChangesBelong ?? '');
    const plannedRepos = new Set(
      repoPlans
        .map((plan) =>
          String(plan.repo ?? '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
    const unplanned = namedRepos.filter(
      (repo) => !plannedRepos.has(repo.toLowerCase()),
    );
    sections.push({
      key: 'repoCoverage',
      label: 'Every repo named is planned',
      ok: unplanned.length === 0,
      hint: unplanned.length
        ? `${unplanned.join(', ')} named as owning a change, but not in the plan.`
        : '',
      detail: unplanned.length
        ? `"Where the change belongs" says the change belongs in ${unplanned.join(
            ', ',
          )}, and /technicalPlan/repos has no entry for ${
            unplanned.length > 1 ? 'those repos' : 'it'
          }. Add one, with changesMd describing what changes there. If the ` +
          'change does not in fact belong there, correct the section instead ' +
          '— a build cannot edit a repo it was not given, and will fix what ' +
          'it can reach rather than what is wrong.'
        : '',
    });

    sections.push(
      ...meaningChecks(
        draft,
        plannedRepos,
        signals,
        sections.every((section) => section.ok),
      ),
    );

    const scoredOkCount = sections
      .slice(0, scoringSectionCount)
      .filter((section) => section.ok).length;
    const score = Math.round((scoredOkCount / scoringSectionCount) * 100);

    return {
      score,
      // Readiness is stricter than the score on purpose: a fully-written PRD
      // with one unsettled question reads as 100% and is still not buildable,
      // which is exactly the state the blockers list exists to explain.
      ready: sections.every((section) => section.ok),
      sections,
      // hint + detail, because the agent is the reader that acts on this list
      // and it cannot see the schema. The admin's tooltip renders `hint` on
      // its own — a pointer-by-pointer repair note in a small tooltip is
      // unreadable, and the two readers genuinely want different lengths.
      blockers: sections
        .filter((section) => !section.ok)
        .map((section) =>
          [section.hint, section.detail].filter(Boolean).join(' '),
        ),
      // Rides with readiness so every place that already receives it — the
      // SSE frame, the PATCH response, the session detail — can show the
      // findings and their dismissals without a second request.
      ...(signals.review !== undefined ? { review: signals.review } : {}),
    };
  }
}

const listOf = (items: string[], max = 6): string =>
  items.length > max
    ? `${items.slice(0, max).join(', ')} and ${items.length - max} more`
    : items.join(', ');

const quoteOf = (text: string, max = 160): string => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/**
 * The rubric rows that check what the PRD means rather than whether it is
 * written — each one a defect a real PRD shipped to "ready" with.
 *
 * Every row only blocks: all of them pass vacuously on a blank document, the
 * way assumptions and open questions do, so counting them in the score would
 * put green ticks against work nobody has done.
 *
 * A check whose signal is missing (`undefined`) is left out entirely rather
 * than passed with a tick, so the rubric never claims to have checked
 * something it could not see.
 */
function meaningChecks(
  draft: BuilderPrdDocument,
  plannedRepos: Set<string>,
  signals: BuilderReadinessSignals,
  structuralRowsPass: boolean,
): BuilderPrdReadinessSection[] {
  const rows: BuilderPrdReadinessSection[] = [];
  const isPlanned = (repo: string) => plannedRepos.has(repo.toLowerCase());
  const requirements = draft.requirements ?? [];
  const repoPlans = draft.technicalPlan?.repos ?? [];

  // Session 2bc3a5cf's v8 carried an ally-ai test plan for a repo its
  // technical plan never touched. A build clones only the planned repos, so
  // those tests could never be written — and the PRD read as thorough.
  // Passes while nothing is planned: the technical-plan row says that.
  const testedRepos = [
    ...new Set([
      ...reposATestPlanTouches(draft.testPlanMd ?? ''),
      ...reposATestPlanTouches(draft.e2ePlanMd ?? ''),
    ]),
  ];
  const untestable = plannedRepos.size
    ? testedRepos.filter((repo) => !isPlanned(repo))
    : [];
  rows.push({
    key: 'testPlanRepos',
    label: 'Tests stay inside the plan',
    ok: untestable.length === 0,
    hint: untestable.length
      ? `The test plan puts tests in ${listOf(untestable)}, which the technical plan doesn't change.`
      : '',
    detail: untestable.length
      ? `testPlanMd / e2ePlanMd give tests to ${listOf(untestable)}, and ` +
        `/technicalPlan/repos has no entry for ${
          untestable.length > 1 ? 'those repos' : 'it'
        }. A build only clones the planned repos, so those tests would never ` +
        'be written. Either plan the repo, with what changes there, or take ' +
        'its tests out of the test plan.'
      : '',
  });

  // Every requirement needs a repo that says it will build it. Matched by id,
  // because the id is the one handle the plan, the milestones and the PR
  // bodies all share. Passes while there are no requirements or no plan —
  // their own rows say so.
  const homeless =
    requirements.length && repoPlans.length
      ? requirements
          .map((requirement, index) => ({ requirement, index }))
          .filter(
            ({ requirement }) =>
              !String(requirement.id ?? '').trim() ||
              !repoPlans.some((plan) =>
                mentionsId(plan.changesMd ?? '', requirement.id),
              ),
          )
      : [];
  const labelOf = ({
    requirement,
    index,
  }: {
    requirement: { id?: string; title?: string };
    index: number;
  }) =>
    String(requirement.id ?? '').trim() ||
    `requirement ${index + 1}${requirement.title ? ` (${requirement.title})` : ''}`;
  rows.push({
    key: 'requirementHomes',
    label: 'Every requirement has a repo',
    ok: homeless.length === 0,
    hint: homeless.length
      ? `${homeless.length} requirement(s) no repo plans to build: ${listOf(
          homeless.map(labelOf),
        )}.`
      : '',
    detail: homeless.length
      ? 'Name each requirement id in the changesMd of the repo(s) that build ' +
        'it — e.g. "(R2) store the rating on the debrief". Not yet assigned: ' +
        listOf(
          homeless.map(
            (entry) =>
              `${labelOf(entry)} at /requirements/${entry.index}` +
              (String(entry.requirement.id ?? '').trim() ? '' : ' (no id)'),
          ),
          12,
        ) +
        '. A requirement no repo plans for is one the build will not do. If it ' +
        'needs no code (a setting, a decision), say so in the plan of the repo ' +
        'it concerns.'
      : '',
  });

  // A learner screen that exists on the web and in the app. Session 2bc3a5cf
  // planned a debrief rating for the web's DebriefTab only; mobile has its
  // own. Matched on component names the catalog found on both platforms.
  if (signals.parityTwins !== undefined) {
    const changeText = [
      ...requirements.map((requirement) =>
        [
          requirement.title,
          requirement.description,
          ...(requirement.acceptanceCriteria ?? []),
        ].join('\n'),
      ),
      ...repoPlans.map((plan) => plan.changesMd ?? ''),
    ].join('\n');
    const touched = signals.parityTwins.filter((twin) =>
      mentionsIdentifier(changeText, twin.name),
    );
    const covered =
      isPlanned('ally-mobile') || /\bmobile\b/i.test(draft.nonGoals ?? '');
    const missing = covered ? [] : touched;
    rows.push({
      key: 'mobileTwins',
      label: 'Mobile twins covered',
      ok: missing.length === 0,
      hint: missing.length
        ? `${listOf(missing.map((twin) => twin.name))} also ${
            missing.length > 1 ? 'exist' : 'exists'
          } on mobile, and ally-mobile isn't planned.`
        : '',
      detail: missing.length
        ? `The requirements or plan change ${listOf(
            missing.map((twin) => twin.name),
          )}, which the learner web app and ally-mobile both have (${listOf(
            missing.map((twin) => `ally-mobile:${twin.mobile}`),
            4,
          )}). Plan ally-mobile with the matching change, or say in Non-goals ` +
          'why mobile is left out — otherwise a learner on the app gets half ' +
          'the feature.'
        : '',
    });
  }

  // "What already exists" must rest on something this session actually read.
  // Session 2bc3a5cf described a module whose files had both returned 404.
  // Skipped for a session with no evidence log (one from before the log),
  // and while the section is empty — its own row says that.
  const existing = String(draft.existingBehaviour ?? '').trim();
  if (signals.evidence && signals.evidence.total > 0 && existing) {
    const { readOk, readFailed } = signals.evidence;
    const cited = citedPaths(existing);
    const grounded = cited.filter((path) =>
      readOk.some((read) => citedPathMatchesRead(path, read)),
    );
    const failedOnly = cited.filter(
      (path) =>
        !grounded.includes(path) &&
        readFailed.some((read) => citedPathMatchesRead(path, read)),
    );
    const ok = grounded.length > 0 && failedOnly.length === 0;
    rows.push({
      key: 'existingGrounded',
      label: 'What already exists was read',
      ok,
      hint: ok
        ? ''
        : failedOnly.length
          ? `What already exists cites ${listOf(failedOnly)}, which couldn't be read.`
          : 'What already exists cites no file this session read.',
      detail: ok
        ? ''
        : failedOnly.length
          ? `Every read of ${listOf(failedOnly)} failed (the evidence log has ` +
            'the error), so what /existingBehaviour says about it is unverified. ' +
            'Search first, read the path the search returned with ' +
            'github_read_file, then correct the section — or take the claim out.'
          : cited.length
            ? `None of the paths /existingBehaviour cites (${listOf(cited)}) was ` +
              'read this session. Read the files that show what exists with ' +
              'github_read_file or wiki_read, and cite those paths.'
            : '/existingBehaviour cites no file paths. Read the files that show ' +
              'what exists (github_read_file / wiki_read) and cite them by path. ' +
              'If nothing exists yet, cite the file you read that shows where ' +
              'the change would go.',
    });
  }

  // The admin's latest words must have reached the document. In session
  // 2bc3a5cf the final clarification's edit failed and the reply still said
  // "revised"; the PRD stayed ready without it. The gatherer leaves out
  // option picks and plain acknowledgements, so "ok, thanks" clears this.
  if (signals.lastAdminMessage !== undefined) {
    const message = signals.lastAdminMessage;
    const applied =
      !message ||
      (signals.lastPrdEditAt instanceof Date &&
        signals.lastPrdEditAt.getTime() >= message.at.getTime());
    rows.push({
      key: 'lastMessageApplied',
      label: 'Your latest message is in the PRD',
      ok: applied,
      hint: applied ? '' : "Your latest message hasn't changed the PRD yet.",
      detail:
        applied || !message
          ? ''
          : `The admin's latest message ("${quoteOf(message.text)}") came ` +
            'after the PRD last changed, and nothing has been written since. ' +
            'Apply what it says with update_prd before saying anything is ' +
            'revised. If it truly changes nothing in the PRD, say why and ask ' +
            'the admin to confirm — their reply clears this.',
    });
  }

  // The cold reviewer. It runs once everything else passes, so before then
  // there is nothing to say; after it, each open finding blocks until it is
  // fixed (a recheck reads the PRD again) or a person dismisses it.
  if (signals.review !== undefined) {
    const review = signals.review;
    const othersPass = structuralRowsPass && rows.every((row) => row.ok);
    const open =
      review?.status === 'done'
        ? (review.findings ?? []).filter((finding) => finding.status === 'open')
        : [];
    const notYetRun = review === null;
    rows.push({
      key: 'prdReview',
      label: 'Cold review',
      // A failed review does not block: a crashed reviewer says nothing about
      // the PRD, and the next write retries it.
      ok: notYetRun ? !othersPass : open.length === 0,
      hint: notYetRun
        ? othersPass
          ? "The PRD review hasn't run yet."
          : ''
        : open.length
          ? `${open.length} review finding(s) to fix or dismiss.`
          : '',
      detail: notYetRun
        ? othersPass
          ? 'A fresh reviewer reads the PRD, the evidence log and the ' +
            'transcript the first time everything else passes; it runs on the ' +
            'next PRD change or at the end of this turn.'
          : ''
        : open.length
          ? 'Fix each open finding in the PRD: ' +
            open
              .map(
                (finding) =>
                  `${finding.id} [${finding.category}, ${finding.section}] ` +
                  `${finding.detail} Fix: ${finding.fix}`,
              )
              .join(' | ') +
            '. Open findings are rechecked against the PRD at the end of the ' +
            'turn. If the admin says a finding is wrong, record that with ' +
            'dismiss_review_finding, quoting their words — never dismiss one ' +
            'on your own judgement.'
          : '',
    });
  }

  return rows;
}
