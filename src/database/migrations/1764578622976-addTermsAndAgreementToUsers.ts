import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTermsAndAgreementToUsers1764578622976
  implements MigrationInterface
{
  name = 'AddTermsAndAgreementToUsers1764578622976';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "termsAndAgreementApproved" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "termsAndAgreementApprovedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "termsAndAgreementApprovedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "termsAndAgreementApproved"`,
    );
  }
}
