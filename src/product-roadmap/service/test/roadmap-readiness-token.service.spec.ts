import { BadRequestException } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';

import { RoadmapReadinessTokenService } from '../roadmap-readiness-token.service';
import { ROADMAP_READINESS_TOKEN_TTL_MS } from '../../constants/product-roadmap.constants';
import { RoadmapOpportunityEffort } from '../../enum/roadmap-opportunity.enum';

/**
 * The signed readiness verdict, which is what turned the checklist from a discipline the admin
 * drawer kept into a rule `POST /opportunities` enforces.
 *
 * Every test here is a way the gate could be walked around, so every one of them asserts a
 * REFUSAL. The happy path is one test; the other seven are the point.
 */
describe('RoadmapReadinessTokenService', () => {
  const config = {
    jwt: { accessToken: { secret: 'test-signing-secret' } },
  } as unknown as AppConfigService;

  const service = new RoadmapReadinessTokenService(config);

  const DRAFT = 'As a counsellor, I lose an hour a week assigning tracks.';
  const GOAL = 'Reliability & Trust';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const issuePassing = () =>
    service.issue({
      description: DRAFT,
      productGoal: GOAL,
      failedCriteria: [],
      proposedEffort: RoadmapOpportunityEffort.M,
    });

  it('round-trips a verdict it signed itself', () => {
    const verdict = service.verify(issuePassing(), {
      description: DRAFT,
      productGoal: GOAL,
    });

    expect(verdict).toEqual({
      failedCriteria: [],
      proposedEffort: RoadmapOpportunityEffort.M,
    });
  });

  /** A failing verdict is signed too — it is what an override gets recorded against. */
  it('carries which criteria failed', () => {
    const token = service.issue({
      description: DRAFT,
      productGoal: GOAL,
      failedCriteria: ['specific', 'who_it_affects'],
      proposedEffort: null,
    });

    expect(
      service.verify(token, { description: DRAFT, productGoal: GOAL })
        .failedCriteria,
    ).toEqual(['specific', 'who_it_affects']);
  });

  /** Trailing whitespace alone must not cost a re-run — the drawer compares trimmed too. */
  it('ignores surrounding whitespace on the description', () => {
    expect(() =>
      service.verify(issuePassing(), {
        description: `  ${DRAFT}\n`,
        productGoal: GOAL,
      }),
    ).not.toThrow();
  });

  /**
   * The bypass this whole mechanism exists to close: grade a throwaway sentence, then file
   * something else against the pass it earned.
   */
  it('refuses a verdict graded against different text', () => {
    expect(() =>
      service.verify(issuePassing(), {
        description: 'something else entirely',
        productGoal: GOAL,
      }),
    ).toThrow(BadRequestException);
  });

  /** The goal is an input the drawer binds its verdicts to, so the server binds it too. */
  it('refuses a verdict graded under a different product goal', () => {
    expect(() =>
      service.verify(issuePassing(), {
        description: DRAFT,
        productGoal: 'Learner Outcomes',
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses a tampered payload', () => {
    const [body] = issuePassing().split('.');
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        d: 'whatever',
        g: 'whatever',
        c: 'whatever',
        f: [],
        e: 's',
        exp: Date.now() + 60_000,
      }),
      'utf8',
    ).toString('base64url');

    // The original signature over a swapped body — the forgery a signature exists to catch.
    const [, signature] = issuePassing().split('.');
    expect(() =>
      service.verify(`${forged}.${signature}`, {
        description: DRAFT,
        productGoal: GOAL,
      }),
    ).toThrow(BadRequestException);
    expect(body).not.toEqual(forged);
  });

  /** A signature of the wrong LENGTH must be refused, not crash timingSafeEqual. */
  it('refuses a malformed token without throwing anything but a 400', () => {
    for (const bad of ['', 'nodot', 'a.b', 'x.'.repeat(3)]) {
      expect(() =>
        service.verify(bad, { description: DRAFT, productGoal: GOAL }),
      ).toThrow(BadRequestException);
    }
  });

  /**
   * `jest.spyOn` rather than reassigning `Date.now`, and restored in `afterEach` rather than a
   * `finally`: `Date.now` is process-global and jest shares a worker process across test FILES,
   * so a hand-rolled patch that ever failed to unwind would push every later suite's clock
   * forward — which reads as expired sessions and expired magic links in code that has nothing
   * to do with this one. The spy is unwound by jest itself even if the assertion throws.
   */
  it('refuses a verdict past its window', () => {
    const token = issuePassing();
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + ROADMAP_READINESS_TOKEN_TTL_MS + 1);

    expect(() =>
      service.verify(token, { description: DRAFT, productGoal: GOAL }),
    ).toThrow(/expired/i);
  });

  /**
   * ROADMAP_READINESS_CRITERIA is documented as expected to change. A token issued against the
   * old set must not be spendable against the new one — otherwise a criterion added today reads
   * as passed on every token in flight, which is the one failure mode that would be invisible.
   */
  it('refuses a verdict issued against a different criteria set', () => {
    const token = issuePassing();
    const constants = jest.requireActual<
      typeof import('../../constants/product-roadmap.constants')
    >('../../constants/product-roadmap.constants');

    // Push a sixth criterion onto the live array, exactly as editing the constant would.
    (
      constants.ROADMAP_READINESS_CRITERIA as unknown as {
        push: (v: unknown) => void;
      }
    ).push({ id: 'brand_new', label: 'Something new', hint: 'hint' });

    try {
      expect(() =>
        service.verify(token, { description: DRAFT, productGoal: GOAL }),
      ).toThrow(/checklist has changed/i);
    } finally {
      (
        constants.ROADMAP_READINESS_CRITERIA as unknown as { pop: () => void }
      ).pop();
    }
  });

  /** A different key must not verify — the guard against one environment's token in another. */
  it('refuses a verdict signed with another key', () => {
    const other = new RoadmapReadinessTokenService({
      jwt: { accessToken: { secret: 'a-different-secret' } },
    } as unknown as AppConfigService);

    expect(() =>
      service.verify(
        other.issue({
          description: DRAFT,
          productGoal: GOAL,
          failedCriteria: [],
          proposedEffort: RoadmapOpportunityEffort.M,
        }),
        { description: DRAFT, productGoal: GOAL },
      ),
    ).toThrow(BadRequestException);
  });

  /**
   * A service that cannot sign cannot gate. Not a 400 — the caller did nothing wrong — and not
   * a silent pass, which is what would happen if the key were allowed to be empty.
   */
  it('refuses to sign at all without a configured secret', () => {
    const unconfigured = new RoadmapReadinessTokenService({
      jwt: { accessToken: { secret: undefined } },
    } as unknown as AppConfigService);

    expect(() =>
      unconfigured.issue({
        description: DRAFT,
        productGoal: GOAL,
        failedCriteria: [],
        proposedEffort: null,
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });
});
