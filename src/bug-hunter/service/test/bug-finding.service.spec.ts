import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { RoadmapOpportunity } from 'src/product-roadmap/entity/roadmap-opportunity.entity';
import { User } from 'src/user/entity/user.entity';
import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { BUG_HUNTER_AGENT_ROADMAP_OWNER } from '../../constants/bug-fix-session.constants';
import { BugFindingRepository } from '../../repository/bug-finding.repository';
import { BugFindingService, RawFinding } from '../bug-finding.service';
import { BugHunterNotificationService } from '../bug-hunter-notification.service';
import { BugHunterService } from '../bug-hunter.service';

import { BugFinding } from '../../entity/bug-finding.entity';
import {
  BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES,
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHunterNotificationLevel } from '../../enum/bug-hunter-notification.enum';

const RUN = 'run-1';
const REPO = 'ally-be';

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  source: BugFindingSource.CODE_REVIEW,
  file: 'src/a.ts',
  description: 'The retry loop never resets the counter, so it retries forever',
  proven: false,
  touchesGuardedPath: false,
  severity: BugFindingSeverity.MEDIUM,
  ...over,
});

const row = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'existing-1',
    repo: REPO,
    source: BugFindingSource.CODE_REVIEW,
    file: 'src/a.ts',
    symbol: null,
    description: raw().description,
    status: BugFindingStatus.NEW,
    proven: false,
    touchesGuardedPath: false,
    ...over,
  }) as BugFinding;

/**
 * `editDescription` and `setStage` write to the event timeline; everything else
 * gets a stub that would fail loudly if it were ever called with the wrong shape.
 */
const bugHunterService = (
  over: Partial<{ appendFindingEvent: jest.Mock }> = {},
) =>
  ({
    appendFindingEvent: jest.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as BugHunterService;

/** Nothing under test here touches the roadmap unless a finding merges. */
const roadmapRepository = (
  over: Partial<{ findOne: jest.Mock; update: jest.Mock }> = {},
) =>
  ({
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as Repository<RoadmapOpportunity>;

/** Name resolution for `enrich` — irrelevant to every case in this file, so it returns nothing. */
const userRepository = () =>
  ({ find: jest.fn().mockResolvedValue([]) }) as unknown as Repository<User>;

describe('BugFindingService.persistFindings', () => {
  let service: BugFindingService;
  let repo: jest.Mocked<
    Pick<
      BugFindingRepository,
      | 'findByReportedBugId'
      | 'listStaleNeedsInput'
      | 'findOpenByDedupeKey'
      | 'findRecentlyDeclinedByDedupeKey'
      | 'findRecentlyShippedByDedupeKey'
      | 'update'
      | 'save'
      | 'create'
      | 'findOne'
    >
  >;

  let notifications: { notify: jest.Mock; wasRaisedSince: jest.Mock };

  beforeEach(() => {
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      wasRaisedSince: jest.fn().mockResolvedValue(false),
    };
    repo = {
      findByReportedBugId: jest.fn().mockResolvedValue(null),
      listStaleNeedsInput: jest.fn().mockResolvedValue([]),
      findOpenByDedupeKey: jest.fn().mockResolvedValue(null),
      // The two other halves of the dedupe question: a bug somebody already
      // declined, and a bug we already fixed. Default to "no history", which
      // is the ordinary case for a genuinely new finding.
      findRecentlyDeclinedByDedupeKey: jest.fn().mockResolvedValue(null),
      findRecentlyShippedByDedupeKey: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((v) => v),
      save: jest
        .fn()
        .mockImplementation((v) => Promise.resolve({ id: 'new-1', ...v })),
      findOne: jest.fn().mockResolvedValue(row()),
    } as never;

    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      notifications as unknown as BugHunterNotificationService,
      roadmapRepository(),
      userRepository(),
      bugHunterService(),
    );
  });

  it('inserts a genuinely new finding at NEW', async () => {
    const [saved] = await service.persistFindings(RUN, REPO, [raw()]);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(saved.status).toBe(BugFindingStatus.NEW);
  });

  it('persists the symbol the finder supplied', async () => {
    await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'retryLoop' }),
    );
  });

  it('touches the existing open row instead of duplicating it', async () => {
    repo.findOpenByDedupeKey.mockResolvedValue(row());
    await service.persistFindings(RUN, REPO, [raw()]);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('existing-1', { runId: RUN });
  });

  /**
   * The sweep re-reads the same code every night, so a decision that only
   * lived on an open row lasted exactly one night. These are the two other
   * things a dedupe-key match can mean.
   */
  describe('a bug somebody already declined', () => {
    const rejected = row({
      id: 'declined-1',
      status: BugFindingStatus.REJECTED,
      decisionReason: 'not_a_bug' as never,
      metadata: null,
    });

    it('does not re-file it', async () => {
      repo.findRecentlyDeclinedByDedupeKey.mockResolvedValue(rejected);
      const [result] = await service.persistFindings(RUN, REPO, [raw()]);

      expect(repo.save).not.toHaveBeenCalled();
      // The declined row comes back rather than nothing, so the caller can
      // still zip its findings to ids in order — and so the sweep sees a
      // `rejected` status and knows to leave it alone.
      expect(result).toBeDefined();
    });

    it('counts the rediscovery so an argument going in circles is visible', async () => {
      repo.findRecentlyDeclinedByDedupeKey.mockResolvedValue(
        row({ ...rejected, metadata: { rediscoveredCount: 2 } } as never),
      );
      await service.persistFindings(RUN, REPO, [raw()]);

      expect(repo.update).toHaveBeenCalledWith(
        'declined-1',
        expect.objectContaining({
          metadata: expect.objectContaining({ rediscoveredCount: 3 }),
        }),
      );
    });

    it('says so on the timeline rather than dropping the finder’s work silently', async () => {
      const events = jest.fn().mockResolvedValue(undefined);
      service = new BugFindingService(
        repo as unknown as BugFindingRepository,
        notifications as unknown as BugHunterNotificationService,
        roadmapRepository(),
        userRepository(),
        bugHunterService({ appendFindingEvent: events }),
      );
      repo.findRecentlyDeclinedByDedupeKey.mockResolvedValue(rejected);

      await service.persistFindings(RUN, REPO, [raw()]);

      expect(events).toHaveBeenCalledWith(
        expect.objectContaining({
          findingId: 'declined-1',
          stage: BugHuntEventStage.RECURRENCE_SUPPRESSED,
        }),
      );
    });

    it('takes precedence over the shipped-fix lookup, so a settled bug is not called a regression', async () => {
      repo.findRecentlyDeclinedByDedupeKey.mockResolvedValue(rejected);
      repo.findRecentlyShippedByDedupeKey.mockResolvedValue(
        row({ id: 'old-fix', status: BugFindingStatus.RELEASED }),
      );

      await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('a fix that did not hold', () => {
    const shipped = row({
      id: 'old-fix',
      status: BugFindingStatus.RELEASED,
      prUrl: 'https://github.com/HelloAllyTech/ally-be/pull/1',
      releasedAt: new Date(Date.now() - 11 * 86_400_000),
    });

    beforeEach(() => {
      repo.findRecentlyShippedByDedupeKey.mockResolvedValue(shipped);
    });

    it('files the new bug linked to the fix that failed', async () => {
      await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ regressionOf: 'old-fix' }),
        }),
      );
    });

    it('marks the earlier fix as regressed, so either drawer tells the story', async () => {
      await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);

      expect(repo.update).toHaveBeenCalledWith(
        'old-fix',
        expect.objectContaining({
          metadata: expect.objectContaining({ regressed: true }),
        }),
      );
    });

    it('tells an admin, because trying the same fix again is probably wrong', async () => {
      // The live case: an ally-ai-learn shutdown race was released on 28
      // August, kept firing, and the 2 September sweep filed it as an
      // ordinary new bug. Filed quietly, the one fact that mattered was the
      // one nobody saw.
      await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: BugHunterNotificationLevel.ACTION_NEEDED,
          title: expect.stringMatching(/didn't hold/i),
        }),
      );
    });

    it('will not claim a regression from a fuzzy description match alone', async () => {
      // With no symbol and no file the dedupe key is a prose fingerprint,
      // which is right for collapsing rewordings and far too loose for
      // telling someone their fix broke.
      await service.persistFindings(RUN, REPO, [
        raw({ symbol: undefined, file: undefined }),
      ]);

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          metadata: expect.objectContaining({ regressionOf: 'old-fix' }),
        }),
      );
    });

    it('still files the finding when the annotations fail', async () => {
      // Every write in the regression path annotates a row that already
      // exists; losing the bug because the note failed would be the wrong
      // trade.
      repo.update.mockRejectedValueOnce(new Error('db blip'));

      const [saved] = await service.persistFindings(RUN, REPO, [
        raw({ symbol: 'retryLoop' }),
      ]);

      expect(saved).toBeDefined();
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('the symbol transition', () => {
    /**
     * A row stored before its finder learned to emit `symbol` is keyed on the
     * description fingerprint. Once the finder DOES supply one, the precise key
     * cannot match that row — and without a second lookup we would open a
     * duplicate for a bug we already have, which is the exact failure the
     * reworked dedupe key exists to prevent.
     */
    it('adopts a symbol-less row when the rediscovery names a symbol', async () => {
      repo.findOpenByDedupeKey
        .mockResolvedValueOnce(null) // precise, symbol-keyed lookup misses
        .mockResolvedValueOnce(row()); // symbol-less fallback key hits

      await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);

      expect(repo.findOpenByDedupeKey).toHaveBeenCalledTimes(2);
      expect(repo.save).not.toHaveBeenCalled();
      // Re-keyed as well as annotated, so the next sweep matches first time
      // rather than re-walking this transition every night.
      expect(repo.update).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({
          runId: RUN,
          symbol: 'retryLoop',
          dedupeKey: expect.any(String),
        }),
      );
    });

    it('does NOT look for a fallback row when the finding has no symbol', async () => {
      // The fingerprint is the fuzzy half; letting a symbol-less finding claim a
      // precisely-keyed row would merge two distinct bugs.
      await service.persistFindings(RUN, REPO, [raw()]);
      expect(repo.findOpenByDedupeKey).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('never overwrites a symbol already on the row', async () => {
      repo.findOpenByDedupeKey.mockResolvedValue(
        row({ symbol: 'alreadyKnown' }),
      );
      await service.persistFindings(RUN, REPO, [
        raw({ symbol: 'somethingElse' }),
      ]);
      expect(repo.update).toHaveBeenCalledWith('existing-1', { runId: RUN });
    });
  });

  describe('reported bugs', () => {
    it('updates the row created at roadmap-intake time, never re-inserting', async () => {
      repo.findByReportedBugId.mockResolvedValue(
        row({ id: 'reported-1', source: BugFindingSource.REPORTED_BUG }),
      );
      await service.persistFindings(RUN, REPO, [
        raw({ source: BugFindingSource.REPORTED_BUG, reportedBugId: 'rb-1' }),
      ]);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.findOpenByDedupeKey).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'reported-1',
        expect.objectContaining({ runId: RUN, repo: REPO }),
      );
    });

    it('falls through to normal dedup when the reported row has gone', async () => {
      repo.findByReportedBugId.mockResolvedValue(null);
      await service.persistFindings(RUN, REPO, [
        raw({
          source: BugFindingSource.REPORTED_BUG,
          reportedBugId: 'rb-gone',
        }),
      ]);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  it('returns rows in input order so the pipeline can zip ids back', async () => {
    repo.save
      .mockResolvedValueOnce({ id: 'first' } as never)
      .mockResolvedValueOnce({ id: 'second' } as never);
    const out = await service.persistFindings(RUN, REPO, [
      raw({ description: 'counter never resets' }),
      raw({ description: 'timezone applied twice' }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['first', 'second']);
  });
});

/**
 * The stale-question digest exists because the inbox is pull-only by design:
 * an unattended sweep asks a question and moves on, so without something to
 * resurface it the bug stops progressing and nobody knows it is waiting on
 * them.
 */
describe('BugFindingService.raiseStaleEscalationDigest', () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = new Date('2026-08-18T12:00:00Z');
  const stale = (over: Partial<BugFinding> = {}): BugFinding =>
    row({
      status: BugFindingStatus.NEEDS_INPUT,
      escalationQuestion: 'Should a suspended tenant still see this?',
      updatedAt: new Date('2026-08-16T12:00:00Z'),
      ...over,
    });

  let service: BugFindingService;
  let repo: { listStaleNeedsInput: jest.Mock };
  let notifications: { notify: jest.Mock; wasRaisedSince: jest.Mock };

  beforeEach(() => {
    repo = { listStaleNeedsInput: jest.fn().mockResolvedValue([]) };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      wasRaisedSince: jest.fn().mockResolvedValue(false),
    };
    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      notifications as unknown as BugHunterNotificationService,
      roadmapRepository(),
      userRepository(),
      bugHunterService(),
    );
  });

  const run = () =>
    service.raiseStaleEscalationDigest(4 * HOUR, 24 * HOUR, NOW);

  it('says nothing when no question is waiting', async () => {
    // A quiet, successful night produces no message — the inbox's own rule.
    await expect(run()).resolves.toEqual({ notified: false, staleCount: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('only considers questions older than the stale window', async () => {
    await run();
    expect(repo.listStaleNeedsInput).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 4 * HOUR),
    );
  });

  it('raises one action_needed message covering all of them', async () => {
    // One message, not one per finding: nine action_needed rows would bury the
    // badge they are meant to light up.
    repo.listStaleNeedsInput.mockResolvedValue([
      stale({ title: 'Suspended tenant sees archived cases' }),
      stale({ title: 'Counsellor list ignores tenant filter' }),
    ]);

    await expect(run()).resolves.toEqual({ notified: true, staleCount: 2 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);

    const [args] = notifications.notify.mock.calls[0];
    expect(args.level).toBe(BugHunterNotificationLevel.ACTION_NEEDED);
    expect(args.body).toContain('Suspended tenant sees archived cases');
    expect(args.body).toContain('Counsellor list ignores tenant filter');
    expect(args.body).toContain('2 bugs');
  });

  it('pins the message to no single finding', async () => {
    // It is about several bugs; a findingId would make the row open the wrong
    // drawer.
    repo.listStaleNeedsInput.mockResolvedValue([stale(), stale()]);
    await run();
    expect(notifications.notify.mock.calls[0][0].findingId).toBeNull();
  });

  it('reports the age of the oldest, which the query returns first', async () => {
    repo.listStaleNeedsInput.mockResolvedValue([
      stale({ updatedAt: new Date('2026-08-15T12:00:00Z') }), // 3 days
      stale({ updatedAt: new Date('2026-08-17T12:00:00Z') }),
    ]);
    await run();
    expect(notifications.notify.mock.calls[0][0].body).toContain('3 days');
  });

  it('stays quiet if it already said this within the quiet period', async () => {
    // Repeating it daily is a nudge; hourly is what turns an inbox into
    // wallpaper.
    repo.listStaleNeedsInput.mockResolvedValue([stale()]);
    notifications.wasRaisedSince.mockResolvedValue(true);

    await expect(run()).resolves.toEqual({ notified: false, staleCount: 1 });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.wasRaisedSince).toHaveBeenCalledWith(
      expect.any(String),
      new Date(NOW.getTime() - 24 * HOUR),
    );
  });

  it('uses singular wording for a single waiting bug', async () => {
    repo.listStaleNeedsInput.mockResolvedValue([stale()]);
    await run();
    expect(notifications.notify.mock.calls[0][0].body).toContain('one bug');
  });
});

/**
 * This is the path a fix agent takes on the common single-repo run: it runs
 * `gh pr merge --admin` itself and then PATCHes the finding to `merged`. If the
 * bug came in through the Product Roadmap, that merge is the moment the
 * reporter's card should move to Released — nothing else asks GitHub about that
 * PR afterwards, so a card missed here is a card that stays wrong forever.
 */
describe('BugFindingService.setStatus — releasing the reporter’s roadmap card', () => {
  const merged = (over: Partial<BugFinding> = {}): BugFinding =>
    row({
      id: 'finding-1',
      status: BugFindingStatus.MERGED,
      reportedBugId: 'opportunity-1',
      ...over,
    });

  let service: BugFindingService;
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let notifications: { notify: jest.Mock; wasRaisedSince: jest.Mock };
  let roadmap: { findOne: jest.Mock; update: jest.Mock };

  const build = () => {
    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      notifications as unknown as BugHunterNotificationService,
      roadmap as unknown as Repository<RoadmapOpportunity>,
      userRepository(),
      bugHunterService(),
    );
  };

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(merged()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      wasRaisedSince: jest.fn().mockResolvedValue(false),
    };
    roadmap = {
      findOne: jest.fn().mockResolvedValue({
        id: 'opportunity-1',
        stage: RoadmapOpportunityStage.NEW,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    build();
  });

  it('releases the linked opportunity when the fix agent reports its own merge', async () => {
    await service.setStatus('finding-1', { status: BugFindingStatus.MERGED });

    expect(roadmap.findOne).toHaveBeenCalledWith({
      where: { id: 'opportunity-1' },
    });
    expect(roadmap.update).toHaveBeenCalledWith('opportunity-1', {
      stage: RoadmapOpportunityStage.RELEASED,
      owner: BUG_HUNTER_AGENT_ROADMAP_OWNER,
      ownerUserId: null,
      releasedAt: expect.any(Date),
    });
  });

  it('does not re-stamp releasedAt on an already-released card', async () => {
    roadmap.findOne.mockResolvedValue({
      id: 'opportunity-1',
      stage: RoadmapOpportunityStage.RELEASED,
    });

    await service.setStatus('finding-1', { status: BugFindingStatus.MERGED });

    expect(roadmap.update).toHaveBeenCalledWith('opportunity-1', {
      stage: RoadmapOpportunityStage.RELEASED,
      owner: BUG_HUNTER_AGENT_ROADMAP_OWNER,
      ownerUserId: null,
    });
  });

  it('leaves the roadmap alone for a sweep finding nobody reported', async () => {
    repo.findOne.mockResolvedValue(merged({ reportedBugId: null }));

    await service.setStatus('finding-1', { status: BugFindingStatus.MERGED });

    expect(roadmap.findOne).not.toHaveBeenCalled();
    expect(roadmap.update).not.toHaveBeenCalled();
  });

  it('leaves the card where it is on any other transition', async () => {
    // pr_opened is the guarded-path handoff: the fix has NOT landed yet, so
    // telling the reporter it shipped would be a lie the reconcile pass would
    // only correct once a human merges.
    repo.findOne.mockResolvedValue(
      merged({ status: BugFindingStatus.PR_OPENED }),
    );

    await service.setStatus('finding-1', {
      status: BugFindingStatus.PR_OPENED,
      prUrl: 'https://github.com/helloallytech/ally-be/pull/1',
    });

    expect(roadmap.update).not.toHaveBeenCalled();
  });

  it('still reports the finding as MERGED when the roadmap write fails', async () => {
    // Best-effort: the status transition is already committed, so a roadmap
    // outage must not turn a merged fix into a failed PATCH.
    roadmap.findOne.mockRejectedValue(new Error('connection reset'));

    const after = await service.setStatus('finding-1', {
      status: BugFindingStatus.MERGED,
    });

    expect(after.status).toBe(BugFindingStatus.MERGED);
    expect(repo.update).toHaveBeenCalledWith('finding-1', {
      status: BugFindingStatus.MERGED,
    });
  });
});

/**
 * An admin rewriting the brief before a fix session runs.
 *
 * What these lock down is not the write — it is the three things the write
 * must leave alone. The description is the fix agent's whole statement of the
 * problem, so an edit that quietly moved the status, lost the finder's
 * original words, or left no trace on the timeline would each remove the
 * ability to answer the only question worth asking after a bad fix: was the
 * agent wrong, or was it told the wrong thing?
 */
describe('BugFindingService.editDescription', () => {
  const EDITOR = 42;
  const NEXT =
    'Searching for a counsellor by phone number returns nobody, even for a number that exists — the query compares the raw input against a normalised column.';

  let service: BugFindingService;
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let hunter: { appendFindingEvent: jest.Mock };

  const build = (finding: BugFinding) => {
    repo = {
      findOne: jest.fn().mockResolvedValue(finding),
      update: jest.fn().mockResolvedValue(undefined),
    };
    hunter = { appendFindingEvent: jest.fn().mockResolvedValue(undefined) };
    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      {
        notify: jest.fn(),
        wasRaisedSince: jest.fn(),
      } as unknown as BugHunterNotificationService,
      roadmapRepository(),
      userRepository(),
      hunter as unknown as BugHunterService,
    );
  };

  it('rewrites the description and keeps the original words', async () => {
    build(row({ id: 'finding-1', description: 'search is broken' }));

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(repo.update).toHaveBeenCalledWith(
      'finding-1',
      expect.objectContaining({
        description: NEXT,
        originalDescription: 'search is broken',
        descriptionEditedBy: EDITOR,
      }),
    );
  });

  it('never overwrites the original with a previous admin’s rewrite', async () => {
    // Second edit: `originalDescription` is already set, and it is the
    // finder's text — not the version being replaced right now.
    build(
      row({
        id: 'finding-1',
        description: 'first rewrite',
        originalDescription: 'what the finder actually said',
      }),
    );

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(repo.update).toHaveBeenCalledWith(
      'finding-1',
      expect.objectContaining({
        originalDescription: 'what the finder actually said',
      }),
    );
  });

  it('does not move the status — editing is not approving', async () => {
    build(row({ id: 'finding-1', status: BugFindingStatus.PENDING_APPROVAL }));

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(repo.update).toHaveBeenCalledWith(
      'finding-1',
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it('records the rewrite on the finding’s own timeline, with both versions', async () => {
    build(row({ id: 'finding-1', description: 'search is broken' }));

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(hunter.appendFindingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 'finding-1',
        stage: BugHuntEventStage.DESCRIPTION_EDITED,
        payload: expect.objectContaining({
          from: 'search is broken',
          to: NEXT,
        }),
      }),
    );
  });

  it('trims, and treats an unchanged description as nothing to do', async () => {
    build(row({ id: 'finding-1', description: NEXT }));

    await service.editDescription('finding-1', `  ${NEXT}  `, EDITOR);

    expect(repo.update).not.toHaveBeenCalled();
    // No work log row either: a "description edited" entry saying nothing
    // changed is noise on a timeline whose job is explaining a fix session.
    expect(hunter.appendFindingEvent).not.toHaveBeenCalled();
  });

  it('refuses a blank rewrite outright', async () => {
    // Regression: `@IsNotEmpty` accepts "   ", so the DTO alone let a
    // whitespace-only PATCH through and stored an empty brief — a fix session
    // asked to fix nothing. The invariant belongs here as well as in the pipe.
    build(row({ id: 'finding-1', description: 'search is broken' }));

    await expect(
      service.editDescription('finding-1', '   \n  ', EDITOR),
    ).rejects.toThrow(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each([
    BugFindingStatus.QUEUED,
    BugFindingStatus.FIXING,
    BugFindingStatus.MERGED,
    BugFindingStatus.RELEASED,
    BugFindingStatus.REJECTED,
  ])('refuses to edit a finding that is %s', async (status) => {
    build(row({ id: 'finding-1', status }));

    await expect(
      service.editDescription('finding-1', NEXT, EDITOR),
    ).rejects.toThrow(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each(BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES)(
    'allows an edit from %s — the same statuses "Put me on it" is offered from',
    async (status) => {
      build(row({ id: 'finding-1', status, description: 'vague' }));

      await expect(
        service.editDescription('finding-1', NEXT, EDITOR),
      ).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalled();
    },
  );
});

describe('BugFindingService.setStage', () => {
  const ADMIN = 7;
  let service: BugFindingService;
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let hunter: { appendFindingEvent: jest.Mock };

  /**
   * `setStage` reads the row, writes, then reads back. The two reads see
   * different rows — before and after the update — so the stub returns them in
   * sequence rather than one fixed row, which is what lets the event summary's
   * "was X" half be asserted at all.
   */
  const build = (before: BugFinding, after: BugFinding) => {
    repo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      update: jest.fn().mockResolvedValue(undefined),
    };
    hunter = { appendFindingEvent: jest.fn().mockResolvedValue(undefined) };
    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      {
        notify: jest.fn(),
        wasRaisedSince: jest.fn(),
      } as unknown as BugHunterNotificationService,
      roadmapRepository(),
      userRepository(),
      hunter as unknown as BugHunterService,
    );
  };

  /**
   * The case the whole feature exists for: somebody fixed the bug with an
   * ordinary hand-written PR, so Bug Hunter's own status never moved off NEW.
   */
  it('pins a stage the pipeline would never have derived, and records who did it', async () => {
    const before = row({ id: 'f1', status: BugFindingStatus.NEW });
    build(
      before,
      row({
        id: 'f1',
        status: BugFindingStatus.NEW,
        stageOverride: RoadmapOpportunityStage.RELEASED,
      }),
    );

    const after = await service.setStage(
      'f1',
      RoadmapOpportunityStage.RELEASED,
      ADMIN,
    );

    expect(repo.update).toHaveBeenCalledWith(
      'f1',
      expect.objectContaining({
        stageOverride: RoadmapOpportunityStage.RELEASED,
        stageOverriddenBy: ADMIN,
        stageOverriddenAt: expect.any(Date),
      }),
    );
    expect(after.stageOverride).toBe(RoadmapOpportunityStage.RELEASED);
  });

  /**
   * Clearing must wipe the stamps too. Leaving `stageOverriddenBy` behind would
   * make the drawer claim a pin that is no longer in force — the row is back to
   * deriving, so nobody pinned it.
   */
  it('clears the pin and its stamps together when the stage is null', async () => {
    build(
      row({
        id: 'f1',
        status: BugFindingStatus.MERGED,
        stageOverride: RoadmapOpportunityStage.NEW,
        stageOverriddenBy: ADMIN,
      }),
      row({ id: 'f1', status: BugFindingStatus.MERGED, stageOverride: null }),
    );

    await service.setStage('f1', null, ADMIN);

    expect(repo.update).toHaveBeenCalledWith('f1', {
      stageOverride: null,
      stageOverriddenBy: null,
      stageOverriddenAt: null,
    });
  });

  /**
   * The timeline is where an admin reconstructs why a bug's stage and its
   * pipeline status disagree. A stage that moved with no entry beside it reads
   * as the pipeline having done it.
   */
  it('writes a runless timeline entry naming the before and after', async () => {
    build(
      row({ id: 'f1', status: BugFindingStatus.NEW, repo: REPO }),
      row({
        id: 'f1',
        status: BugFindingStatus.NEW,
        repo: REPO,
        stageOverride: RoadmapOpportunityStage.RELEASED,
      }),
    );

    await service.setStage('f1', RoadmapOpportunityStage.RELEASED, ADMIN);

    expect(hunter.appendFindingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 'f1',
        stage: BugHuntEventStage.STAGE_CHANGED,
        summary: expect.stringContaining('was new'),
        payload: expect.objectContaining({
          changedBy: ADMIN,
          from: RoadmapOpportunityStage.NEW,
          to: RoadmapOpportunityStage.RELEASED,
          pinned: true,
        }),
      }),
    );
  });

  /**
   * Pinning a stage to what it already derives to is a real act, not a no-op:
   * "I checked this and it is right" is worth recording, and it stops a later
   * transition from silently moving it.
   */
  it('still records a pin when the stage does not actually change', async () => {
    build(
      row({ id: 'f1', status: BugFindingStatus.MERGED }),
      row({
        id: 'f1',
        status: BugFindingStatus.MERGED,
        stageOverride: RoadmapOpportunityStage.RELEASED,
      }),
    );

    await service.setStage('f1', RoadmapOpportunityStage.RELEASED, ADMIN);

    expect(hunter.appendFindingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining('now pinned'),
        payload: expect.objectContaining({ pinned: true }),
      }),
    );
  });
});

describe('BugFindingService.enrich', () => {
  const build = (
    opportunities: Partial<RoadmapOpportunity>[],
    users: Partial<User>[],
  ) => {
    const roadmap = {
      find: jest.fn().mockResolvedValue(opportunities),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    const usersRepo = { find: jest.fn().mockResolvedValue(users) };
    return {
      roadmap,
      service: new BugFindingService(
        { findOne: jest.fn() } as unknown as BugFindingRepository,
        {
          notify: jest.fn(),
          wasRaisedSince: jest.fn(),
        } as unknown as BugHunterNotificationService,
        roadmap as unknown as Repository<RoadmapOpportunity>,
        usersRepo as unknown as Repository<User>,
        bugHunterService(),
      ),
    };
  };

  it('returns nothing without querying at all for an empty page', async () => {
    const { service, roadmap } = build([], []);

    await expect(service.enrich([])).resolves.toEqual([]);
    expect(roadmap.find).not.toHaveBeenCalled();
  });

  /**
   * The reporter block is the only thing separating a real user's report from
   * an agent-found lint error now that bugs are not on the roadmap board.
   */
  it('attaches the reporter, their tenant and their captured context', async () => {
    const reportedAt = new Date('2026-08-20T10:00:00Z');
    const { service } = build(
      [
        {
          id: 'opp-1',
          source: 'consumer',
          createdBy: 12,
          tenantId: 'acme',
          reporterContext: { screen: '/cases', os: 'Android 14' },
          createdAt: reportedAt,
        } as Partial<RoadmapOpportunity>,
      ],
      [{ id: 12, name: 'Priya' }],
    );

    const [enriched] = await service.enrich([
      row({ id: 'f1', reportedBugId: 'opp-1' }),
    ]);

    expect(enriched.report).toEqual({
      opportunityId: 'opp-1',
      reporterSource: 'consumer',
      reportedBy: 12,
      reportedByName: 'Priya',
      tenantId: 'acme',
      reporterContext: { screen: '/cases', os: 'Android 14' },
      reportedAt,
    });
  });

  it('leaves a sweep-found finding with no reporter block', async () => {
    const { service, roadmap } = build([], []);

    const [enriched] = await service.enrich([
      row({ id: 'f1', reportedBugId: null }),
    ]);

    expect(enriched.report).toBeNull();
    expect(roadmap.find).not.toHaveBeenCalled();
  });

  /**
   * A finding whose roadmap row was hard-deleted, or whose reporter's account is
   * gone, still has to render — that is precisely the row somebody is trying to
   * look at. Degrade to nulls, never throw.
   */
  it('degrades to nulls when the roadmap row or the user is gone', async () => {
    const { service } = build([], []);

    const [enriched] = await service.enrich([
      row({ id: 'f1', reportedBugId: 'opp-gone', stageOverriddenBy: 99 }),
    ]);

    expect(enriched.report).toBeNull();
    expect(enriched.stageOverriddenByName).toBeNull();
  });

  /**
   * Batched on purpose: the obvious per-row lookup inside the DTO mapper is 100
   * round trips to render a 50-row table.
   */
  it('reads every reporter and stage-pinner in one query each', async () => {
    const { service, roadmap } = build(
      [
        { id: 'opp-1', source: 'staff', createdBy: 1, createdAt: new Date() },
        {
          id: 'opp-2',
          source: 'consumer',
          createdBy: 2,
          createdAt: new Date(),
        },
      ] as Partial<RoadmapOpportunity>[],
      [
        { id: 1, name: 'One' },
        { id: 2, name: 'Two' },
        { id: 3, name: 'Three' },
      ],
    );

    const enriched = await service.enrich([
      row({ id: 'f1', reportedBugId: 'opp-1' }),
      row({ id: 'f2', reportedBugId: 'opp-2', stageOverriddenBy: 3 }),
      row({ id: 'f3', reportedBugId: null }),
    ]);

    expect(roadmap.find).toHaveBeenCalledTimes(1);
    expect(enriched.map((f) => f.report?.reportedByName ?? null)).toEqual([
      'One',
      'Two',
      null,
    ]);
    expect(enriched[1].stageOverriddenByName).toBe('Three');
  });
});

/**
 * The decline path, which is the commonest action on the whole tab and until
 * now recorded only who and when.
 */
describe('BugFindingService.reject', () => {
  const build = (finding: BugFinding) => {
    const events = jest.fn().mockResolvedValue(undefined);
    const repo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(finding)
        .mockResolvedValue({
          ...finding,
          status: BugFindingStatus.REJECTED,
        } as BugFinding),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      {
        notify: jest.fn(),
        wasRaisedSince: jest.fn(),
      } as unknown as BugHunterNotificationService,
      roadmapRepository(),
      userRepository(),
      bugHunterService({ appendFindingEvent: events }),
    );
    return { service, repo, events };
  };

  it('stores the reason and the note alongside who decided', async () => {
    const { service, repo } = build(
      row({ status: BugFindingStatus.PENDING_APPROVAL }),
    );

    await service.reject(
      'existing-1',
      7,
      'not_a_bug' as never,
      '  the guard upstream makes this unreachable  ',
    );

    expect(repo.update).toHaveBeenCalledWith(
      'existing-1',
      expect.objectContaining({
        status: BugFindingStatus.REJECTED,
        decidedBy: 7,
        decisionReason: 'not_a_bug',
        // Trimmed, so a note of only spaces is stored as absence rather than
        // as whitespace that renders an empty line in the sweep prompt.
        decisionNote: 'the guard upstream makes this unreachable',
      }),
    );
  });

  it('stores no note rather than an empty one', async () => {
    const { service, repo } = build(
      row({ status: BugFindingStatus.PENDING_APPROVAL }),
    );

    await service.reject('existing-1', 7, 'wont_fix' as never, '   ');

    expect(repo.update).toHaveBeenCalledWith(
      'existing-1',
      expect.objectContaining({ decisionNote: null }),
    );
  });

  it('records the decision on the timeline, with its reason', async () => {
    // A rejection used to appear on the drawer's work log as a bare status
    // change — the one event on that timeline where nothing further will ever
    // happen, and the one with no explanation beside it.
    const { service, events } = build(
      row({ status: BugFindingStatus.PENDING_APPROVAL }),
    );

    await service.reject('existing-1', 7, 'duplicate' as never, null);

    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: BugHuntEventStage.DECISION_RECORDED,
        summary: expect.stringContaining('duplicate'),
      }),
    );
  });

  it('still refuses to reject from a status that has moved on', async () => {
    const { service } = build(row({ status: BugFindingStatus.FIXING }));

    await expect(
      service.reject('existing-1', 7, 'not_a_bug' as never),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('BugFindingService.setStatus — a declined bug stays declined', () => {
  const build = (finding: BugFinding) => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(finding),
      update: jest.fn().mockResolvedValue(undefined),
    };
    return new BugFindingService(
      repo as unknown as BugFindingRepository,
      {
        notify: jest.fn(),
        wasRaisedSince: jest.fn(),
      } as unknown as BugHunterNotificationService,
      roadmapRepository(),
      userRepository(),
      bugHunterService(),
    );
  };

  it.each([BugFindingStatus.REJECTED, BugFindingStatus.DISMISSED])(
    'refuses to move a %s finding back into the pipeline',
    async (status) => {
      // The enforcement half of the dedupe suppression: the sweep is TOLD to
      // leave a declined row alone, and this is what happens if it does not.
      const service = build(row({ status }));

      await expect(
        service.setStatus('existing-1', { status: BugFindingStatus.FIXING }),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('names the reason in the refusal, so the agent can report something useful', async () => {
    const service = build(
      row({
        status: BugFindingStatus.REJECTED,
        decisionReason: 'wont_fix' as never,
      }),
    );

    await expect(
      service.setStatus('existing-1', { status: BugFindingStatus.FIXING }),
    ).rejects.toThrow(/wont_fix/);
  });

  it('allows a repeated dismissal, because a retried PATCH is not a revival', async () => {
    const service = build(row({ status: BugFindingStatus.DISMISSED }));

    await expect(
      service.setStatus('existing-1', {
        status: BugFindingStatus.DISMISSED,
      }),
    ).resolves.toBeDefined();
  });
});

describe('BugFindingService.setStatus — verifier confidence', () => {
  const build = () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(row({ metadata: { foo: 1 } })),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      {
        notify: jest.fn(),
        wasRaisedSince: jest.fn(),
      } as unknown as BugHunterNotificationService,
      roadmapRepository(),
      userRepository(),
      bugHunterService(),
    );
    return { service, repo };
  };

  it('stores a valid certainty without clobbering the rest of metadata', async () => {
    const { service, repo } = build();

    await service.setStatus('existing-1', { confidence: 0.42 });

    expect(repo.update).toHaveBeenCalledWith(
      'existing-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ foo: 1, confidence: 0.42 }),
      }),
    );
  });

  it.each([95, -1, 1.5, Number.NaN])(
    'discards %p rather than storing it',
    async (value) => {
      // A model reporting 95 instead of 0.95 would otherwise read as maximum
      // confidence — the wrong direction to fail in, since confidence is what
      // decides whether a human looks before an agent writes code.
      const { service, repo } = build();

      await service.setStatus('existing-1', { confidence: value });

      const patch = repo.update.mock.calls[0][1] as Record<string, unknown>;
      expect(patch.metadata).toBeUndefined();
    },
  );
});
