import { DataSource } from 'typeorm';
import { RoadmapOpportunity } from '../../../product-roadmap/entity/roadmap-opportunity.entity';
import { RoadmapAllocation } from '../../../product-roadmap/entity/roadmap-allocation.entity';
import { RoadmapOpportunityComment } from '../../../product-roadmap/entity/roadmap-opportunity-comment.entity';
import { RoadmapInterviewNote } from '../../../product-roadmap/entity/roadmap-interview-note.entity';
import { RoadmapSavedView } from '../../../product-roadmap/entity/roadmap-saved-view.entity';
import { RoadmapUserTabOrder } from '../../../product-roadmap/entity/roadmap-user-tab-order.entity';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../../../product-roadmap/enum/roadmap-opportunity.enum';
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
const ALLOCATIONS: Array<{
  opportunityKey: string;
  monthsAgo: number;
  votes: number;
}> = [
  { opportunityKey: 'scribe-sentiment-chart', monthsAgo: 0, votes: 40 },
  { opportunityKey: 'tenant-onboarding-checklist', monthsAgo: 0, votes: 30 },
  { opportunityKey: 'actor-interrupt-break', monthsAgo: 1, votes: 20 },
];

function periodKey(monthsAgo: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 7);
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

  for (const allocation of ALLOCATIONS) {
    const opportunity = opportunityByKey.get(allocation.opportunityKey);
    if (!opportunity) continue;
    await upsert(
      allocationRepo,
      {
        userId: adminUserId,
        opportunityId: opportunity.id,
        periodKey: periodKey(allocation.monthsAgo),
      },
      { votes: allocation.votes },
    );
  }

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
    `product roadmap: ${OPPORTUNITIES.length} opportunities, ${ALLOCATIONS.length} allocations, 1 comment, 1 interview note, 1 saved view`,
  );
}
