import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FHS_RUBRIC_VERSION } from '../constants/helping-skills-rubric.constants';
import {
  SelfAssessmentDueReason,
  SelfAssessmentTrigger,
} from '../enum/self-assessment.enum';
import { SelfAssessmentRepository } from '../repository/self-assessment.repository';
import { SelfAssessmentService } from '../service/self-assessment.service';

const NOW = new Date('2026-10-05T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000);

const build = (state: {
  last?: { answeredAt: Date; trigger: string; triggerRef: string | null };
  scoredCuts?: number;
  scoredCutsAtLast?: number;
  course?: { trackId: string; completedAt: Date } | null;
}) => {
  const manager = { query: jest.fn() };
  const repository = {
    findLast: jest.fn().mockResolvedValue(state.last ?? null),
    countScoredCuts: jest.fn((_u: number, _v: string, closedBy?: Date) =>
      Promise.resolve(
        closedBy ? (state.scoredCutsAtLast ?? 0) : (state.scoredCuts ?? 0),
      ),
    ),
    latestCourseCompletionSince: jest
      .fn()
      .mockResolvedValue(state.course ?? null),
    lockLearner: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue({ id: 'row-1', answeredAt: NOW }),
  };
  const dataSource = {
    transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)),
  };
  const service = new SelfAssessmentService(
    dataSource as unknown as DataSource,
    repository as unknown as SelfAssessmentRepository,
  );
  return { service, repository, dataSource, manager };
};

const caller = { id: 42, tenantId: 'tenant-a' };

describe('SelfAssessmentService.getDue', () => {
  it('returns ONBOARDING with the instrument for a learner who never answered', async () => {
    const { service, repository } = build({ scoredCuts: 4 });
    const due = await service.getDue(42, NOW);
    expect(due).toMatchObject({
      due: true,
      trigger: SelfAssessmentTrigger.ONBOARDING,
      reason: SelfAssessmentDueReason.NEVER_ANSWERED,
      lastAnsweredAt: null,
      nextEligibleAt: null,
    });
    expect(due.instrument.version).toBe('v1');
    expect(due.instrument.items).toHaveLength(14);
    expect(due.instrument.scale).toEqual({
      min: 0,
      max: 10,
      minLabel: 'Not at all confident',
      maxLabel: 'Completely confident',
    });
    // Counted on the pinned rubric; no recount with no previous answer.
    expect(repository.countScoredCuts).toHaveBeenCalledTimes(1);
    expect(repository.countScoredCuts.mock.calls[0][1]).toBe(
      FHS_RUBRIC_VERSION,
    );
    expect(repository.latestCourseCompletionSince.mock.calls[0][1]).toBeNull();
  });

  it('recounts at the last answer only when it was not a CUTS answer', async () => {
    const onboarding = build({
      last: { answeredAt: daysAgo(5), trigger: 'ONBOARDING', triggerRef: null },
      scoredCuts: 7,
      scoredCutsAtLast: 4,
    });
    const due = await onboarding.service.getDue(42, NOW);
    expect(due).toMatchObject({ due: true, trigger: 'CUTS' });
    expect(onboarding.repository.countScoredCuts).toHaveBeenCalledTimes(2);
    expect(onboarding.repository.countScoredCuts.mock.calls[1][2]).toEqual(
      daysAgo(5),
    );

    const cuts = build({
      last: { answeredAt: daysAgo(5), trigger: 'CUTS', triggerRef: '6' },
      scoredCuts: 7,
    });
    expect(await cuts.service.getDue(42, NOW)).toMatchObject({
      due: false,
      reason: SelfAssessmentDueReason.NOTHING_NEW,
    });
    expect(cuts.repository.countScoredCuts).toHaveBeenCalledTimes(1);
  });

  it('says when the next answer is accepted inside the 24-hour guard', async () => {
    const { service } = build({
      last: { answeredAt: daysAgo(0.5), trigger: 'CUTS', triggerRef: '3' },
      scoredCuts: 40,
    });
    expect(await service.getDue(42, NOW)).toMatchObject({
      due: false,
      reason: SelfAssessmentDueReason.TOO_SOON,
      lastAnsweredAt: daysAgo(0.5).toISOString(),
      nextEligibleAt: new Date(daysAgo(0.5).getTime() + 86400000).toISOString(),
    });
  });
});

describe('SelfAssessmentService.submit', () => {
  const dto = (over: Record<string, unknown> = {}) =>
    ({
      instrumentVersion: 'v1',
      trigger: SelfAssessmentTrigger.ONBOARDING,
      responses: { verbal: 6, harm: 3, goals: null },
      ...over,
    }) as any;

  it('stores a due answer inside a locked transaction, with server-derived trigger data', async () => {
    const { service, repository, manager } = build({});
    const result = await service.submit(caller, dto(), NOW);

    expect(result).toEqual({
      id: 'row-1',
      answeredAt: NOW.toISOString(),
      trigger: SelfAssessmentTrigger.ONBOARDING,
      answeredItems: 2,
    });
    expect(repository.lockLearner).toHaveBeenCalledWith(42, manager);
    // The due facts are re-read on the transaction, after the lock.
    expect(repository.findLast).toHaveBeenCalledWith(42, manager);
    expect(repository.lockLearner.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findLast.mock.invocationCallOrder[0],
    );
    expect(repository.insert).toHaveBeenCalledWith(
      {
        userId: 42,
        tenantId: 'tenant-a',
        instrumentVersion: 'v1',
        trigger: SelfAssessmentTrigger.ONBOARDING,
        triggerRef: null,
        responses: { verbal: 6, harm: 3 },
        answeredAt: NOW,
      },
      manager,
    );
  });

  it('stores the scored-cut count for a CUTS answer and the trackId for a COURSE one', async () => {
    const cuts = build({
      last: { answeredAt: daysAgo(9), trigger: 'CUTS', triggerRef: '2' },
      scoredCuts: 5,
    });
    await cuts.service.submit(caller, dto({ trigger: 'CUTS' }), NOW);
    expect(cuts.repository.insert.mock.calls[0][0]).toMatchObject({
      trigger: 'CUTS',
      triggerRef: '5',
    });

    const course = build({
      last: { answeredAt: daysAgo(9), trigger: 'CUTS', triggerRef: '2' },
      scoredCuts: 3,
      course: { trackId: 'track-9', completedAt: daysAgo(1) },
    });
    await course.service.submit(caller, dto({ trigger: 'COURSE' }), NOW);
    expect(course.repository.insert.mock.calls[0][0]).toMatchObject({
      trigger: 'COURSE',
      triggerRef: 'track-9',
    });
  });

  it('stores a dismissal (every item skipped) as an empty answer', async () => {
    const { service, repository } = build({});
    const result = await service.submit(caller, dto({ responses: {} }), NOW);
    expect(result.answeredItems).toBe(0);
    expect(repository.insert.mock.calls[0][0].responses).toEqual({});
  });

  it('refuses with 409 when nothing is due', async () => {
    const { service, repository } = build({
      last: { answeredAt: daysAgo(3), trigger: 'CUTS', triggerRef: '4' },
      scoredCuts: 5,
    });
    await expect(
      service.submit(caller, dto({ trigger: 'CUTS' }), NOW),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.submit(caller, dto({ trigger: 'CUTS' }), NOW),
    ).rejects.toThrow(/nothing has changed/);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('refuses with 409 inside the 24-hour guard', async () => {
    const { service } = build({
      last: {
        answeredAt: daysAgo(0.2),
        trigger: 'ONBOARDING',
        triggerRef: null,
      },
      scoredCuts: 50,
    });
    await expect(
      service.submit(caller, dto({ trigger: 'CUTS' }), NOW),
    ).rejects.toThrow(/last 24 hours/);
  });

  it('refuses with 409 when the due trigger is not the one submitted', async () => {
    const { service, repository } = build({
      last: { answeredAt: daysAgo(9), trigger: 'CUTS', triggerRef: '2' },
      scoredCuts: 5,
    });
    await expect(
      service.submit(caller, dto({ trigger: 'COURSE' }), NOW),
    ).rejects.toThrow(/due now is CUTS, not COURSE/);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('refuses with 400 an unknown instrument version, before touching the database', async () => {
    const { service, dataSource } = build({});
    await expect(
      service.submit(caller, dto({ instrumentVersion: 'v9' }), NOW),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses with 400 a malformed answer, naming each problem', async () => {
    const { service, dataSource } = build({});
    const error = await service
      .submit(
        caller,
        dto({ responses: { verbal: 12, notASkill: 3, harm: 'high' } }),
        NOW,
      )
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    const messages: string[] = error.getResponse().message;
    expect(messages).toHaveLength(3);
    expect(messages.join(' ')).toContain('"notASkill" is not an item');
    expect(messages.join(' ')).toContain('"verbal" must be');
    expect(messages.join(' ')).toContain('"harm" must be');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('needs an authenticated learner with an org', async () => {
    const { service } = build({});
    await expect(
      service.submit({ id: 0, tenantId: 't' }, dto(), NOW),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.submit({ id: 42, tenantId: null }, dto(), NOW),
    ).rejects.toThrow(BadRequestException);
  });
});
