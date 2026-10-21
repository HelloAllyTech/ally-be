import { BuilderMessageRole } from '../../enum/builder.enum';
import {
  BuilderReadinessService,
  freeTextOf,
  lastAdminMessageToApply,
} from '../builder-readiness.service';

const message = (overrides: Record<string, any>) =>
  ({
    role: BuilderMessageRole.USER,
    content: '',
    metadata: null,
    createdAt: new Date('2026-10-20T10:00:00Z'),
    ...overrides,
  }) as any;

describe('BuilderReadinessService', () => {
  describe('freeTextOf', () => {
    it('strips the card-answer prefix from typed text', () => {
      expect(
        freeTextOf(
          message({ content: '[answers question q1] Mobile needs it too.' }),
        ),
      ).toBe('Mobile needs it too.');
    });

    it('treats a pure option pick as no free text', () => {
      expect(
        freeTextOf(
          message({
            content: '[answers question q1] Guardrail [selected ids: a]',
            metadata: { answer: { selectedOptionIds: ['a'] } },
          }),
        ),
      ).toBeNull();
    });

    it('takes the custom text of a card answer', () => {
      expect(
        freeTextOf(
          message({
            metadata: {
              answer: { selectedOptionIds: [], customValues: ['Use both'] },
            },
          }),
        ),
      ).toBe('Use both');
    });
  });

  describe('lastAdminMessageToApply', () => {
    const assistant = message({
      role: BuilderMessageRole.ASSISTANT,
      content: 'Done.',
    });

    it("returns the admin's latest words", () => {
      const latest = message({
        content: 'Promotion already exists, reuse it.',
        createdAt: new Date('2026-10-20T10:05:00Z'),
      });
      expect(
        lastAdminMessageToApply([
          message({ content: 'first' }),
          assistant,
          latest,
        ]),
      ).toEqual({
        text: 'Promotion already exists, reuse it.',
        at: new Date('2026-10-20T10:05:00Z'),
      });
    });

    it('returns null when the latest is an acknowledgement or a pick', () => {
      expect(
        lastAdminMessageToApply([
          message({ content: 'Mobile too.' }),
          assistant,
          message({ content: 'ok, thanks' }),
        ]),
      ).toBeNull();
      expect(
        lastAdminMessageToApply([
          message({
            content: '[answers question q2] Weight',
            metadata: { answer: { selectedOptionIds: ['weight'] } },
          }),
        ]),
      ).toBeNull();
    });
  });

  describe('planning and settling the review', () => {
    const sections = (allOk: boolean) => [
      { key: 'summary', ok: allOk },
      { key: 'prdReview', ok: false },
    ];
    let prdService: { computeReadiness: jest.Mock };
    let reviewService: { review: jest.Mock; recheck: jest.Mock };
    let service: BuilderReadinessService;

    const doc = (review: any, versionNumber = 5) =>
      ({ id: 'doc-1', draft: {}, versionNumber, review }) as any;
    const openReview = (checkedVersion: number) => ({
      status: 'done',
      checkedVersion,
      findings: [{ id: 'F1', status: 'open' }],
    });

    beforeEach(() => {
      prdService = {
        computeReadiness: jest.fn().mockReturnValue({
          ready: false,
          sections: sections(true),
        }),
      };
      reviewService = {
        review: jest.fn().mockResolvedValue({}),
        recheck: jest.fn().mockResolvedValue({}),
      };
      service = new BuilderReadinessService(
        prdService as any,
        { parityTwins: jest.fn().mockResolvedValue([]) } as any,
        { readOutcomes: jest.fn().mockResolvedValue(undefined) } as any,
        { listBySession: jest.fn().mockResolvedValue([]) } as any,
        { latestCreatedAt: jest.fn().mockResolvedValue(null) } as any,
        reviewService as any,
      );
    });

    const plan = (readinessOk: boolean, d: any, occasion: any) =>
      service.reviewPlan(
        { ready: false, sections: sections(readinessOk) } as any,
        d,
        occasion,
      );

    it('waits until every other row passes', () => {
      expect(plan(false, doc(null), 'edit')).toBeNull();
    });

    it('runs the first review on any occasion, including inside an edit', () => {
      expect(plan(true, doc(null), 'edit')).toBe('review');
      expect(plan(true, doc(null), 'turn_end')).toBe('review');
    });

    it('rechecks open findings after the PRD changed, but not inside an edit', () => {
      expect(plan(true, doc(openReview(4), 5), 'turn_end')).toBe('recheck');
      expect(plan(true, doc(openReview(4), 5), 'admin_edit')).toBe('recheck');
      expect(plan(true, doc(openReview(4), 5), 'edit')).toBeNull();
      expect(plan(true, doc(openReview(5), 5), 'turn_end')).toBeNull();
    });

    it('retries a failed review a bounded number of times', () => {
      expect(
        plan(
          true,
          doc({ status: 'failed', failures: 1, findings: [] }),
          'turn_end',
        ),
      ).toBe('review');
      expect(
        plan(
          true,
          doc({ status: 'failed', failures: 3, findings: [] }),
          'turn_end',
        ),
      ).toBeNull();
    });

    it('settles by running the planned review and re-assessing', async () => {
      const target = doc(null);

      await service.settle('session-1', target, 'turn_end');

      expect(reviewService.review).toHaveBeenCalledWith('session-1', target, {
        timeoutMs: expect.any(Number),
      });
      expect(prdService.computeReadiness).toHaveBeenCalledTimes(2);
    });

    it('gives an admin save a shorter review timeout than a turn', async () => {
      await service.settle('session-1', doc(null), 'admin_edit');
      await service.settle('session-1', doc(null), 'turn_end');

      const [adminCall, turnCall] = reviewService.review.mock.calls;
      expect(adminCall[2].timeoutMs).toBeLessThan(60_000);
      expect(turnCall[2].timeoutMs).toBeGreaterThan(adminCall[2].timeoutMs);
    });

    it('fails soft: an unreadable catalog leaves the twin check out', async () => {
      const failing = new BuilderReadinessService(
        prdService as any,
        {
          parityTwins: jest.fn().mockRejectedValue(new Error('db down')),
        } as any,
        { readOutcomes: jest.fn().mockResolvedValue(undefined) } as any,
        { listBySession: jest.fn().mockResolvedValue([]) } as any,
        { latestCreatedAt: jest.fn().mockResolvedValue(null) } as any,
        reviewService as any,
      );

      const signals = await failing.gatherSignals('session-1', doc(null));

      expect(signals.parityTwins).toBeUndefined();
      expect(signals.review).toBeNull();
      expect(signals.lastAdminMessage).toBeNull();
    });
  });
});
