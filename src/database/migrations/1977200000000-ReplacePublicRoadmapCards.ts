import { MigrationInterface, QueryRunner } from 'typeorm';

type Card = {
  category: 'prepare' | 'perform';
  stage: 'idea' | 'lab' | 'beta' | 'released' | 'stable';
  title: string;
  description: string;
  note?: string;
};

/**
 * Replaces every card on the public product roadmap (app.helloally.ai/blog/roadmap)
 * with the line-up of what Ally is building as of mid-October 2026.
 *
 * Deliberately wholesale: it deletes all existing rows, hidden ones and any
 * edits made from Settings → Roadmap included, rather than patching the launch
 * seed card by card. Cards in each category × stage cell are listed top to
 * bottom. Hand-written, never `migration:generate`.
 */
const REPLACEMENT_CARDS: Card[] = [
  {
    category: 'prepare',
    stage: 'lab',
    title: 'Authoring Studio',
    description:
      'Trainers build courses and roleplays themselves — no engineering help needed.',
    note: 'Current priority',
  },
  {
    category: 'prepare',
    stage: 'lab',
    title: 'Authoring Co-pilot',
    description:
      'Describe the course you need; an AI co-pilot interviews you, then drafts the lessons, quizzes and roleplays.',
  },
  {
    category: 'prepare',
    stage: 'beta',
    title: 'Debrief Supervisor',
    description:
      'After every roleplay, an AI supervisor talks the worker through what went well and what to try next.',
  },
  {
    category: 'prepare',
    stage: 'beta',
    title: 'Competency Measurement',
    description:
      'Tracks how each worker’s helping skills grow across roleplays, so programmes can see what training changes.',
  },
  {
    category: 'prepare',
    stage: 'released',
    title: 'Courses',
    description:
      'Full mental health training programmes for ASHAs, community health workers and lay counsellors.',
  },
  {
    category: 'prepare',
    stage: 'stable',
    title: 'Voice Roleplays',
    description:
      'Practise real counselling conversations with AI clients, in Indian languages.',
  },
  {
    category: 'perform',
    stage: 'idea',
    title: 'Care Worker Co-pilot',
    description:
      'An AI assistant workers can turn to for guidance while they support people in the field.',
  },
  {
    category: 'perform',
    stage: 'lab',
    title: 'Text Chat Helpline',
    description:
      'A ready-to-run text helpline: a chat queue, listener and supervisor workspaces, and live monitoring.',
    note: 'Pilot in 3 months',
  },
  {
    category: 'perform',
    stage: 'lab',
    title: 'WhatsApp Q&A',
    description:
      'Workers ask mental health questions on WhatsApp and get answers drawn from vetted training material.',
  },
  {
    category: 'perform',
    stage: 'beta',
    title: 'Helpline Note Taker',
    description:
      'Counsellors speak their notes after a call, and Ally fills in the case record for them.',
  },
];

/** The launch seed from `1976500000000-CreatePublicRoadmapItems`, restored by `down()`. */
const LAUNCH_CARDS: Card[] = [
  {
    category: 'prepare',
    stage: 'idea',
    title: 'Voice-first certification',
    description:
      'Spoken assessments that certify workers who speak fluently but don’t read or write.',
  },
  {
    category: 'prepare',
    stage: 'idea',
    title: 'Skill refreshers',
    description:
      'Short spoken practice drills on the phone, between formal trainings.',
  },
  {
    category: 'prepare',
    stage: 'lab',
    title: 'Authoring Studio',
    description:
      'Trainers build courses and roleplays themselves — no engineering help needed.',
    note: 'Current priority',
  },
  {
    category: 'prepare',
    stage: 'lab',
    title: 'Listener Practice Game',
    description:
      'Certifies volunteer peer listeners, built on Ally’s roleplay engine.',
    note: 'Pilot in 3 months',
  },
  {
    category: 'prepare',
    stage: 'beta',
    title: 'Learner App',
    description:
      'A vertical, voice-first LMS shaped around how frontline workers actually learn.',
    note: 'Current priority',
  },
  {
    category: 'prepare',
    stage: 'released',
    title: 'Courses',
    description:
      'Full mental health training programmes for ASHAs, community health workers and lay counsellors.',
  },
  {
    category: 'prepare',
    stage: 'stable',
    title: 'Voice Roleplays',
    description:
      'Practise real counselling conversations with AI clients, in Indian languages.',
  },
  {
    category: 'perform',
    stage: 'idea',
    title: 'Field Companion',
    description:
      'In-the-moment voice guidance during home visits and community sessions.',
  },
  {
    category: 'perform',
    stage: 'idea',
    title: 'Supervision Loop',
    description:
      'Supervisors review real cases and send spoken feedback back to workers.',
  },
  {
    category: 'perform',
    stage: 'lab',
    title: 'Peer-Listener Helpline',
    description:
      'A global text helpline staffed by certified volunteers. Ally builds the tech; a nonprofit partner runs it.',
    note: 'Pilot in 3 months',
  },
];

const replaceAll = async (queryRunner: QueryRunner, cards: Card[]) => {
  await queryRunner.query(`DELETE FROM "public_roadmap_items"`);
  const positionInCell = new Map<string, number>();
  for (const card of cards) {
    const cell = `${card.category}/${card.stage}`;
    const sortOrder = positionInCell.get(cell) ?? 0;
    positionInCell.set(cell, sortOrder + 1);
    await queryRunner.query(
      `INSERT INTO "public_roadmap_items" ("category", "stage", "title", "description", "note", "sort_order") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        card.category,
        card.stage,
        card.title,
        card.description,
        card.note ?? null,
        sortOrder,
      ],
    );
  }
};

export class ReplacePublicRoadmapCards1977200000000 implements MigrationInterface {
  name = 'ReplacePublicRoadmapCards1977200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await replaceAll(queryRunner, REPLACEMENT_CARDS);
  }

  /** Puts back the launch seed. Edits made before `up()` ran are not recoverable. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await replaceAll(queryRunner, LAUNCH_CARDS);
  }
}
