import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an opportunity carry reference images — screenshots, mocks, a photo of a whiteboard —
 * attached when it is filed and edited afterwards.
 *
 * WHY: the description is 1000 characters of prose about something that is very often visual.
 * "The filter row wraps onto two lines below 1200px" is a sentence somebody has to reconstruct
 * a picture from; the screenshot IS the description. Until now the only way to attach one was to
 * paste a link into Notes, which meant the image lived wherever that link pointed and rotted on
 * its own schedule.
 *
 * ## jsonb array, not a child table
 *
 * `[{ "url": "...", "caption": "..." }]`. Nothing links to an individual image, nothing filters
 * or aggregates by one, and the ORDER is part of the data — so a child table would buy ids and a
 * FK nobody reads, and cost a join on the module's hottest query (the board loads every card)
 * plus a second write path inside split/merge. Promote it if an image ever needs to be commented
 * on or linked to on its own; see the note on the entity column.
 *
 * ## NOT NULL DEFAULT '[]'
 *
 * "No images" is an empty array, never NULL, so no read path has to handle both and every
 * existing row is correct the moment this runs. The default also covers the insert paths that
 * do not mention the column at all — the Supabase importer, the seeds, and split's new parts.
 *
 * ## The CHECK is the real guarantee
 *
 * A jsonb column will accept a number, a string, or a 400-element array. class-validator gives a
 * friendly 400 on the way in; this makes a bad row impossible even from psql, which matters more
 * than usual here because the array is rendered as <img src> in the admin dashboard for every
 * roadmap viewer. It constrains the SHAPE (an array, bounded, of objects each carrying a text
 * `url`) — it deliberately does not try to validate that the URL points at our own bucket, which
 * is a fact about configuration rather than about data and is enforced in
 * RoadmapOpportunityService.assertOwnReferenceImages.
 *
 * The per-element half is written as jsonpath predicates rather than the obvious
 * `NOT EXISTS (SELECT 1 FROM jsonb_array_elements(...))`, because PostgreSQL rejects a subquery
 * in a CHECK constraint at parse time (0A000, "cannot use subquery in check constraint") — it
 * never gets as far as looking at a row, so the table being empty does not save you. `@?` is a
 * plain immutable operator and is allowed. Each clause is phrased negatively ("no element
 * violates") because a jsonpath filter that matches nothing is a pass, which is what we want for
 * an empty array. `!exists(@.url)` is load-bearing: without it a url-less element matches no
 * filter and slips through.
 *
 * No index. The array is read as part of a row somebody is already looking at, and nothing
 * queries into it.
 */
export class AddRoadmapOpportunityReferenceImages1944400000000 implements MigrationInterface {
  name = 'AddRoadmapOpportunityReferenceImages1944400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "referenceImages" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opportunities_reference_images" ` +
        `CHECK (` +
        `jsonb_typeof("referenceImages") = 'array' ` +
        `AND jsonb_array_length("referenceImages") <= 6 ` +
        `AND NOT ("referenceImages" @? '$[*] ? (@.type() != "object")') ` +
        `AND NOT ("referenceImages" @? ` +
        `'$[*] ? (!exists(@.url) || @.url.type() != "string" || @.url == "")')` +
        `)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT "CHK_roadmap_opportunities_reference_images"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "referenceImages"`,
    );
  }
}
