import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The cards on the public product roadmap (app.helloally.ai/blog/roadmap).
 *
 * Each card is a product or feature placed on a fixed grid: a category
 * (prepare / perform) by a maturity stage (idea → lab → beta → released →
 * stable). The grid's headings live in the frontend; only cards are data,
 * edited from Settings → Roadmap in the admin console. Platform-wide, not
 * tenant-scoped. Hand-written, never `migration:generate`.
 *
 * Seeded with the October 2026 roadmap so the page is not empty on the day it
 * ships. The seed is plain data: editing or deleting any of it from the admin
 * console is expected, and `down()` drops the table regardless.
 */
export class CreatePublicRoadmapItems1976500000000 implements MigrationInterface {
  name = 'CreatePublicRoadmapItems1976500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "public_roadmap_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(60) NOT NULL,
        "description" character varying(200) NOT NULL,
        "note" character varying(40),
        "category" character varying(16) NOT NULL,
        "stage" character varying(16) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_public" boolean NOT NULL DEFAULT true,
        "created_by" integer,
        "updated_by" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_public_roadmap_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_public_roadmap_items_category"
          CHECK ("category" IN ('prepare', 'perform')),
        CONSTRAINT "CHK_public_roadmap_items_stage"
          CHECK ("stage" IN ('idea', 'lab', 'beta', 'released', 'stable'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_public_roadmap_items_cell" ON "public_roadmap_items" ("category", "stage", "sort_order")`,
    );

    const [{ count }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "public_roadmap_items"`,
    );
    if (count > 0) return;

    // Cards in each category × stage cell are listed top to bottom.
    const seed: {
      category: string;
      stage: string;
      title: string;
      description: string;
      note?: string;
    }[] = [
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
    const positionInCell = new Map<string, number>();
    for (const card of seed) {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "public_roadmap_items"`);
  }
}
