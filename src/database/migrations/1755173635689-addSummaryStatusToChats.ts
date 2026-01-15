import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSummaryStatusToChats1755173635689 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" ADD COLUMN "summaryStatus" character varying`,
    );

    await queryRunner.query(
      `WITH summary_data AS (
                SELECT 
                    chats.id,
                    call_details.summary
                FROM chats 
                LEFT JOIN call_details ON call_details."chatId" = chats.id
                WHERE chats."summaryStatus" IS NULL
            )
            UPDATE "chats" 
            SET "summaryStatus" = 
            CASE 
                WHEN summary_data.summary IS NOT NULL 
                    AND summary_data.summary != '[]'
                    AND summary_data.summary != '{}'
                THEN 'SUCCESS'
                ELSE 'FAILED'
            END
            FROM summary_data
            WHERE chats.id = summary_data.id`,
    );

    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "summaryStatus" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "summaryStatus" SET DEFAULT 'PENDING'`,
    );

    await queryRunner.query(`ALTER TABLE "chats" ADD "metadata" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "metadata"`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "summaryStatus"`);
  }
}
