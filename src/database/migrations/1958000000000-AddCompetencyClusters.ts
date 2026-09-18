import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Competency clusters: a named grouping of competencies that the simulation
 * builder can select as a whole, expanding to every competency under it.
 *
 * Membership is many-to-many on purpose. An admin curating frameworks is the
 * expert on which competencies belong together and how their frameworks
 * overlap, so nothing here forces a competency into a single cluster — and
 * nothing here creates a cluster for them. The tables ship EMPTY; the first
 * cluster is whatever an admin makes in the Competencies tab.
 *
 * The scenario side stores the EXPANDED competency ids, never the cluster (see
 * `scenarios.competencyIds`, added in 1843). So re-clustering later cannot
 * retroactively change what an already-published simulation assesses.
 */
export class AddCompetencyClusters1958000000000 implements MigrationInterface {
  name = 'AddCompetencyClusters1958000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "competency_clusters" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "createdBy" integer, CONSTRAINT "PK_competency_clusters_id" PRIMARY KEY ("id"))`,
    );
    // Cluster names are the thing an author reads in the picker, so two
    // clusters with the same name would be indistinguishable. Case-insensitive
    // so a differently-cased duplicate can't slip past it either.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_competency_clusters_name" ON "competency_clusters" (LOWER("name"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "competency_cluster_members" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "clusterId" uuid NOT NULL, "competencyId" uuid NOT NULL, CONSTRAINT "PK_competency_cluster_members_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_competency_cluster_members_cluster_competency" UNIQUE ("clusterId", "competencyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_competency_cluster_members_clusterId" ON "competency_cluster_members" ("clusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_competency_cluster_members_competencyId" ON "competency_cluster_members" ("competencyId")`,
    );
    // Cascade both ways: deleting a cluster or a competency should drop the
    // membership row, not leave an orphan the picker would try to expand.
    await queryRunner.query(
      `ALTER TABLE "competency_cluster_members" ADD CONSTRAINT "FK_competency_cluster_members_cluster" FOREIGN KEY ("clusterId") REFERENCES "competency_clusters"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_cluster_members" ADD CONSTRAINT "FK_competency_cluster_members_competency" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "competency_cluster_members" DROP CONSTRAINT "FK_competency_cluster_members_competency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_cluster_members" DROP CONSTRAINT "FK_competency_cluster_members_cluster"`,
    );
    await queryRunner.query(`DROP TABLE "competency_cluster_members"`);
    await queryRunner.query(`DROP TABLE "competency_clusters"`);
  }
}
