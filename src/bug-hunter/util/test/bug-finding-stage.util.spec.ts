import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { deriveStage, effectiveStage } from '../bug-finding-stage.util';

const finding = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    status: BugFindingStatus.NEW,
    stageOverride: null,
    ...over,
  }) as BugFinding;

describe('deriveStage', () => {
  /**
   * The whole point of the map being exhaustive is that a status added later
   * cannot quietly land on New. TypeScript catches a MISSING key at compile
   * time; this catches the other half — a key added but left pointing at
   * something that is not a stage at all.
   */
  it('has an opinion about every status the pipeline can produce', () => {
    for (const status of Object.values(BugFindingStatus)) {
      expect(Object.values(RoadmapOpportunityStage)).toContain(
        deriveStage(status),
      );
    }
  });

  it.each([
    [BugFindingStatus.NEW, RoadmapOpportunityStage.NEW],
    [BugFindingStatus.PENDING_APPROVAL, RoadmapOpportunityStage.NEW],
    [BugFindingStatus.APPROVED, RoadmapOpportunityStage.PRIORITISED],
    [BugFindingStatus.QUEUED, RoadmapOpportunityStage.PRIORITISED],
    [BugFindingStatus.FIXING, RoadmapOpportunityStage.UNDER_DEVELOPMENT],
    [BugFindingStatus.PR_OPENED, RoadmapOpportunityStage.UNDER_DEVELOPMENT],
    [BugFindingStatus.MERGED, RoadmapOpportunityStage.RELEASED],
    [BugFindingStatus.RELEASED, RoadmapOpportunityStage.RELEASED],
    [BugFindingStatus.DISMISSED, RoadmapOpportunityStage.ARCHIVED],
    [BugFindingStatus.CANCELLED, RoadmapOpportunityStage.ARCHIVED],
  ])('reads %s as %s', (status, stage) => {
    expect(deriveStage(status)).toBe(stage);
  });

  /**
   * NEEDS_INPUT is the one worth pinning down. Work HAS started on it and is
   * blocked on an answer, which is a different situation from nobody having
   * picked the bug up — putting it back at New would hide an in-flight session
   * among the untriaged.
   */
  it('keeps a bug waiting on an answer in development, not back at New', () => {
    expect(deriveStage(BugFindingStatus.NEEDS_INPUT)).toBe(
      RoadmapOpportunityStage.UNDER_DEVELOPMENT,
    );
  });

  /**
   * FAILED means the agent gave up and nothing landed; RELEASE_FAILED means the
   * fix IS on master and only the deploy went red. Both are Archived on this
   * coarse ladder because no work is in flight — that they are retryable is
   * what the pipeline status badge beside the stage is for.
   */
  it('archives both failure kinds rather than leaving them in development', () => {
    expect(deriveStage(BugFindingStatus.FAILED)).toBe(
      RoadmapOpportunityStage.ARCHIVED,
    );
    expect(deriveStage(BugFindingStatus.RELEASE_FAILED)).toBe(
      RoadmapOpportunityStage.ARCHIVED,
    );
  });
});

describe('effectiveStage', () => {
  it('derives from status when nothing is pinned', () => {
    expect(effectiveStage(finding({ status: BugFindingStatus.FIXING }))).toBe(
      RoadmapOpportunityStage.UNDER_DEVELOPMENT,
    );
  });

  /**
   * The case the override exists for: a bug fixed with an ordinary hand-written
   * PR. Bug Hunter never ran, so `status` is still NEW and would derive to New
   * forever — and since bugs are no longer on the roadmap board, no other screen
   * would ever show the correction.
   */
  it('lets a pinned stage win over the derived one', () => {
    expect(
      effectiveStage(
        finding({
          status: BugFindingStatus.NEW,
          stageOverride: RoadmapOpportunityStage.RELEASED,
        }),
      ),
    ).toBe(RoadmapOpportunityStage.RELEASED);
  });

  /**
   * A pin STICKS. If a later sweep re-finds the same bug and drags it back to
   * FIXING, the admin's "this already shipped" must survive — they are the only
   * party who knows about the out-of-band fix.
   */
  it('keeps the pin after the pipeline moves on', () => {
    expect(
      effectiveStage(
        finding({
          status: BugFindingStatus.FIXING,
          stageOverride: RoadmapOpportunityStage.RELEASED,
        }),
      ),
    ).toBe(RoadmapOpportunityStage.RELEASED);
  });

  it('falls back to derivation once the pin is cleared', () => {
    expect(
      effectiveStage(
        finding({ status: BugFindingStatus.MERGED, stageOverride: null }),
      ),
    ).toBe(RoadmapOpportunityStage.RELEASED);
  });
});
