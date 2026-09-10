import { DataSource } from 'typeorm';
import { RoadmapOpportunity } from '../../../product-roadmap/entity/roadmap-opportunity.entity';
import { RoadmapAllocation } from '../../../product-roadmap/entity/roadmap-allocation.entity';
import { RoadmapOpportunityComment } from '../../../product-roadmap/entity/roadmap-opportunity-comment.entity';
import { RoadmapInterviewNote } from '../../../product-roadmap/entity/roadmap-interview-note.entity';
import { RoadmapSavedView } from '../../../product-roadmap/entity/roadmap-saved-view.entity';
import { RoadmapUserTabOrder } from '../../../product-roadmap/entity/roadmap-user-tab-order.entity';
import { RoadmapVoteGrant } from '../../../product-roadmap/entity/roadmap-vote-grant.entity';
import { RoadmapVoteGrantRepository } from '../../../product-roadmap/repository/roadmap-vote-grant.repository';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../../../product-roadmap/enum/roadmap-opportunity.enum';
import {
  ROADMAP_VOTE_GRANT_DAILY,
  ROADMAP_VOTE_GRANT_EXPIRY_DAYS,
  ROADMAP_VOTE_GRANT_MONTHLY,
} from '../../../product-roadmap/constants/product-roadmap.constants';
import {
  currentDayKey,
  currentPeriodKey,
} from '../../../product-roadmap/util/roadmap-period.util';
import { getRepo, log, upsert } from '../helpers';

interface OpportunityFixture {
  key: string;
  description: string;
  type: RoadmapOpportunityType;
  stage: RoadmapOpportunityStage;
  // Must match a name seeded by migration 1871000000002-SeedProductRoadmapTaxonomy —
  // both productGoal and owner are FK-by-name.
  productGoal: string;
  owner?: string;
  hasOwnerUser?: boolean;
  prd?: string;
  releasedAt?: Date;
}

const OPPORTUNITIES: OpportunityFixture[] = [
  {
    key: 'scribe-sentiment-chart',
    description:
      'Add a sentiment trend chart to Scribe session summaries so counsellors can see mood shifts across a call at a glance.',
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.NEW,
    productGoal: 'Scribe',
  },
  {
    key: 'marathi-tts-latency',
    description:
      'Voice latency spikes on Marathi TTS during peak hours, causing the roleplay actor to pause mid-sentence.',
    type: RoadmapOpportunityType.BUG,
    stage: RoadmapOpportunityStage.PRIORITISED,
    productGoal: 'Reliability & Trust',
    owner: 'Sandeep Malhotra',
    hasOwnerUser: true,
  },
  {
    key: 'actor-interrupt-break',
    description:
      'Roleplay actor breaks character when interrupted mid-sentence instead of yielding the turn gracefully.',
    type: RoadmapOpportunityType.BUG,
    stage: RoadmapOpportunityStage.UNDER_DEVELOPMENT,
    productGoal: 'Roleplay Actor Realism',
    owner: 'Shubham Bhoite',
    hasOwnerUser: true,
    prd: 'Detect interruption via VAD during actor TTS playback; on interrupt, truncate the in-flight turn and resume from the client message instead of replaying the full script.',
  },
  {
    key: 'coaching-rubric-presets',
    description:
      'Ship coaching rubric presets for the most common competencies so managers stop hand-building the same rubric per scenario.',
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.RELEASED,
    productGoal: 'Coaching Effectiveness',
    owner: 'Gopikrishnan Sasikumar',
    releasedAt: new Date('2026-06-15T00:00:00.000Z'),
  },
  {
    key: 'tenant-onboarding-checklist',
    description:
      'Explore an automated onboarding checklist for new tenants to reduce first-week setup support tickets.',
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.NEW,
    productGoal: 'Engagement & Usability',
  },
  {
    key: 'retire-legacy-pathway-builder',
    description:
      'Retire the legacy pathway-builder experiment now that scenario paths cover the same use case natively.',
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.ARCHIVED,
    productGoal: 'Foundation & Experiments',
    owner: 'Ajey Gore',
  },
];

// Votes cast by the seed admin: two NEW-stage opportunities in the current
// period, plus a historical allocation from a prior period on an opportunity that
// has since moved on (allocations are never removed on a stage change).
//
// Every vote here has to be paid for out of the grant ledger — see seedVoteGrants and
// spendSeededVotes below, and migration 1962100000000's trigger, which rejects an
// allocation the writer has no balance for.
const ALLOCATIONS: Array<{
  opportunityKey: string;
  monthsAgo: number;
  votes: number;
}> = [
  { opportunityKey: 'scribe-sentiment-chart', monthsAgo: 0, votes: 40 },
  { opportunityKey: 'tenant-onboarding-checklist', monthsAgo: 0, votes: 30 },
  { opportunityKey: 'actor-interrupt-break', monthsAgo: 1, votes: 20 },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_MS = ROADMAP_VOTE_GRANT_EXPIRY_DAYS * DAY_MS;

/** What the fixtures above spend, and therefore what the ledger below has to cover. */
const TOTAL_FIXTURE_VOTES = ALLOCATIONS.reduce(
  (total, allocation) => total + allocation.votes,
  0,
);

/**
 * How many days of daily grants to issue, on top of the current month's 50.
 *
 * Derived from the fixtures rather than hardcoded so that editing a vote count above cannot
 * silently reintroduce the failure this exists to prevent — enough to cover every fixture
 * vote, plus two days' headroom so the seeded admin lands with a small spendable balance and
 * can actually cast a vote in the local UI. Clamped below the expiry window so every grant
 * issued here is still live.
 */
const DAILY_GRANT_DAYS = Math.min(
  ROADMAP_VOTE_GRANT_EXPIRY_DAYS - 1,
  Math.ceil(
    Math.max(0, TOTAL_FIXTURE_VOTES - ROADMAP_VOTE_GRANT_MONTHLY) /
      ROADMAP_VOTE_GRANT_DAILY,
  ) + 2,
);

function periodKey(monthsAgo: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 7);
}

/**
 * Issue the vote grants that pay for the fixture allocations.
 *
 * Since migration 1962100000000 a user's votes are drawn from the roadmap_vote_grants ledger,
 * and a DB trigger rejects any allocation write whose positive delta exceeds the writer's live
 * balance. That trigger is deliberately a backstop against EVERY writer — "a future one-off
 * script, a backfill, or anyone in psql", as its docblock puts it — and this seeder is exactly
 * such a writer. So the seed cannot write votes without first giving the admin a balance to
 * spend, and the honest way to do that is to seed the grants a real account would have accrued
 * rather than to weaken the trigger.
 *
 * Shape mirrors what RoadmapVoteGrantSchedulerRegistrationService would have issued: this
 * month's monthly grant plus one daily grant per day, each backdated to the day it represents
 * and expiring 30 days after that. Idempotent through `upsert` on the ledger's own natural key
 * (userId, source, grantKey) — the same key the unique index and the scheduler's ON CONFLICT
 * use — so a re-run, or a scheduler tick that already issued today's grant, adds nothing.
 *
 * Scoped to the seed admin, the only user the fixtures cast votes for. Every other eligible
 * super admin already got today's daily grant from migration 1962000000000's one-time step.
 */
async function seedVoteGrants(ds: DataSource, userId: number): Promise<void> {
  const grantRepo = getRepo(ds, RoadmapVoteGrant);
  const now = new Date();

  // Backdated to the 1st of the month, which is when the scheduler would have issued it — but
  // never further back than one day short of the expiry window. Without that clamp a seed run
  // on the 31st of a 31-day month would issue a monthly grant that expired the moment it was
  // written, and the trigger would reject the very allocations it was issued to pay for.
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const earliestStillLive = new Date(
    now.getTime() - (ROADMAP_VOTE_GRANT_EXPIRY_DAYS - 1) * DAY_MS,
  );
  const monthlyGrantedAt =
    startOfMonth > earliestStillLive ? startOfMonth : earliestStillLive;

  await upsert(
    grantRepo,
    { userId, source: 'monthly', grantKey: currentPeriodKey(now) },
    {
      amount: ROADMAP_VOTE_GRANT_MONTHLY,
      grantedAt: monthlyGrantedAt,
      expiresAt: new Date(monthlyGrantedAt.getTime() + EXPIRY_MS),
    },
  );

  for (let daysAgo = 0; daysAgo < DAILY_GRANT_DAYS; daysAgo += 1) {
    const grantedAt = new Date(now.getTime() - daysAgo * DAY_MS);
    await upsert(
      grantRepo,
      { userId, source: 'daily', grantKey: currentDayKey(grantedAt) },
      {
        amount: ROADMAP_VOTE_GRANT_DAILY,
        grantedAt,
        expiresAt: new Date(grantedAt.getTime() + EXPIRY_MS),
      },
    );
  }
}

/**
 * Draw the votes this run just cast down from the ledger.
 *
 * The trigger only validates; spending is the writer's job (RoadmapAllocationService does it
 * with this same repository call). Skipping it would leave a state no real usage can produce —
 * allocations that nothing paid for — and the local UI would show a full balance sitting next
 * to votes already cast.
 *
 * Charges only the rows this run inserted, which is what keeps it idempotent: a re-run creates
 * no rows and so spends nothing. It also deliberately leaves any OTHER allocations the database
 * already holds unpaid, rather than reconciling the user's whole vote history against their
 * grants. Votes cast before the ledger existed were explicitly not backfilled — see migration
 * 1962000000000's docblock, "every vote already cast this month stays exactly as cast" — and a
 * dev database restored from before the cutover can hold plenty of them. Retroactively charging
 * those would empty the balance the seed just issued and reverse a decision that was made on
 * purpose.
 */
async function spendSeededVotes(
  ds: DataSource,
  userId: number,
  votes: number,
): Promise<void> {
  if (votes <= 0) return;

  // Reuses the ledger's own FIFO-by-expiry spend rather than restating it here, so seeded
  // consumption draws grants down in exactly the order real voting does.
  await new RoadmapVoteGrantRepository(ds).consume(ds.manager, userId, votes);
}

export async function seedRoadmap(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const opportunityRepo = getRepo(ds, RoadmapOpportunity);
  const allocationRepo = getRepo(ds, RoadmapAllocation);
  const commentRepo = getRepo(ds, RoadmapOpportunityComment);
  const noteRepo = getRepo(ds, RoadmapInterviewNote);
  const savedViewRepo = getRepo(ds, RoadmapSavedView);
  const tabOrderRepo = getRepo(ds, RoadmapUserTabOrder);

  const opportunityByKey = new Map<string, RoadmapOpportunity>();
  for (const fixture of OPPORTUNITIES) {
    const opportunity = await upsert(
      opportunityRepo,
      { description: fixture.description },
      {
        type: fixture.type,
        stage: fixture.stage,
        productGoal: fixture.productGoal,
        owner: fixture.owner ?? null,
        ownerUserId: fixture.hasOwnerUser ? adminUserId : null,
        prd: fixture.prd ?? null,
        releasedAt: fixture.releasedAt ?? null,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    );
    opportunityByKey.set(fixture.key, opportunity);
  }

  // Before the allocations, never after: the trigger reads the balance at the instant each
  // allocation row is written.
  await seedVoteGrants(ds, adminUserId);

  // Counted rather than summed from ALLOCATIONS, so a re-run — where every row already exists
  // and upsert leaves it alone — spends nothing the first run has already spent.
  let votesCastThisRun = 0;
  for (const allocation of ALLOCATIONS) {
    const opportunity = opportunityByKey.get(allocation.opportunityKey);
    if (!opportunity) continue;
    const matchOn = {
      userId: adminUserId,
      opportunityId: opportunity.id,
      periodKey: periodKey(allocation.monthsAgo),
    };
    const existing = await allocationRepo.findOne({ where: matchOn });
    if (existing) continue;
    await allocationRepo.save(
      allocationRepo.create({ ...matchOn, votes: allocation.votes }),
    );
    votesCastThisRun += allocation.votes;
  }

  await spendSeededVotes(ds, adminUserId, votesCastThisRun);

  const latencyBug = opportunityByKey.get('marathi-tts-latency');
  if (latencyBug) {
    await upsert(
      commentRepo,
      {
        opportunityId: latencyBug.id,
        body: 'Confirmed repro on peak-hour load in staging. Escalating to Sandeep.',
      },
      { createdBy: adminUserId, updatedBy: adminUserId },
    );
  }

  await upsert(
    noteRepo,
    { title: 'User interview — enterprise tenant onboarding friction' },
    {
      interviewee: 'Ops lead, Northwind Health',
      summary:
        'Their team spent most of the first week re-creating scenarios manually because they were not aware of the pathway import feature. Suggests a guided first-run checklist.',
      createdBy: adminUserId,
      updatedBy: adminUserId,
    },
  );

  const savedView = await upsert(
    savedViewRepo,
    { name: 'My Bugs', createdBy: adminUserId },
    {
      state: { typeFilter: [RoadmapOpportunityType.BUG] },
      pinned: false,
      updatedBy: adminUserId,
    },
  );

  await upsert(
    tabOrderRepo,
    { userId: adminUserId },
    { viewIds: [savedView.id] },
  );

  log(
    `product roadmap: ${OPPORTUNITIES.length} opportunities, ${ALLOCATIONS.length} allocations ` +
      `(${TOTAL_FIXTURE_VOTES} votes drawn from ${DAILY_GRANT_DAYS + 1} vote grants), ` +
      `1 comment, 1 interview note, 1 saved view`,
  );
}
