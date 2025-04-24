import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserGroupData1745476361289 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get all users
    const users = await queryRunner.query(`SELECT id, role FROM users`);

    // Get group IDs
    const groupsData = await queryRunner.query(
      `SELECT id, "group" FROM groups`,
    );
    const groupMap = new Map(groupsData.map((g: any) => [g.group, g.id]));

    // Create user-group associations based on user roles
    for (const user of users) {
      const groupId = groupMap.get(user.role.toUpperCase());
      if (groupId) {
        await queryRunner.query(
          `INSERT INTO "user_groups" ("userId", "groupId") VALUES ($1, $2)`,
          [user.id, groupId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "user_groups"`);
  }
}
