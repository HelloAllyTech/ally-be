import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  applyJsonPatch,
  JsonPatchError,
  JsonPatchOp,
} from 'src/common/util/json-patch.util';
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
  createEmptyPrdDocument,
} from '../type/builder-prd.type';
import {
  createPrdNormaliseDiagnostics,
  normalisePrdDocument,
  PrdNormaliseDiagnostics,
} from '../util/builder-prd-normalise.util';

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
  { key: 'goals', label: 'Goals', minLength: 30 },
  { key: 'nonGoals', label: 'Non-goals', minLength: 20 },
  { key: 'testPlanMd', label: 'Test plan', minLength: 40 },
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
    // Fail fast against the caller's already-loaded draft so an obviously bad
    // patch (unknown path, etc.) never opens a transaction. The authoritative
    // application happens inside persistDraftMutation against whatever draft
    // is current at write time.
    try {
      applyJsonPatch(doc.draft, ops);
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

          let nextDraft: BuilderPrdDocument;
          try {
            nextDraft = applyJsonPatch(current.draft, ops);
          } catch (error) {
            if (error instanceof JsonPatchError) {
              throw new BadRequestException(
                `PRD patch failed at operation ${error.opIndex ?? 0}: ${error.message}`,
              );
            }
            throw error;
          }

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
  computeReadiness(draft: BuilderPrdDocument): BuilderPrdReadiness {
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
    // Carries the index because that is what the agent needs in order to
    // patch: "requirement 1 has no criteria" is actionable, "a requirement has
    // no criteria" sends it re-reading the whole array to find out which.
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
            'sentences at: ' +
            requirementsWithoutCriteria
              .map(
                ({ requirement, index }) =>
                  `/requirements/${index}/acceptanceCriteria (${
                    requirement.title || requirement.id || 'untitled'
                  })`,
              )
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
          ? `Set ${unnamedRepoPlans
              .map(({ index }) => `/technicalPlan/repos/${index}/repo`)
              .join(', ')} to one of: ${repoChoices}. ${planShape}`
          : unknownRepoPlans.length
            ? `Allowed values: ${repoChoices}. Fix ${unknownRepoPlans
                .map(({ index }) => `/technicalPlan/repos/${index}/repo`)
                .join(', ')}.`
            : emptyRepoPlans.length
              ? 'Write what changes in that repo, in enough detail to start ' +
                'from, at: ' +
                emptyRepoPlans
                  .map(({ index }) => `/technicalPlan/repos/${index}/changesMd`)
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
    };
  }

  /** PRD + its score, the shape every read endpoint and SSE frame carries. */
  async getPrdWithReadiness(
    sessionId: string,
    userId: number,
  ): Promise<{ doc: BuilderPrdDoc; readiness: BuilderPrdReadiness }> {
    const doc = await this.getOrCreateDoc(sessionId, userId);
    return { doc, readiness: this.computeReadiness(doc.draft) };
  }
}
