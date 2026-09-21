import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey } from "typeorm";

export class CreateCourseDiscussionTables1789971679002 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn("track_items", new TableColumn({
            name: "has_discussion",
            type: "boolean",
            default: false,
        }));

        await queryRunner.createTable(new Table({
            name: "course_discussions",
            columns: [
                {
                    name: "id",
                    type: "uuid",
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: "uuid",
                },
                {
                    name: "track_item_id",
                    type: "uuid",
                },
                {
                    name: "is_locked",
                    type: "boolean",
                    default: false,
                },
                {
                    name: "created_by_id",
                    type: "uuid",
                },
                {
                    name: "created_at",
                    type: "timestamp",
                    default: "now()",
                },
                {
                    name: "updated_at",
                    type: "timestamp",
                    default: "now()",
                },
                {
                    name: "deleted_at",
                    type: "timestamp",
                    isNullable: true,
                },
            ],
        }));

        await queryRunner.createForeignKey("course_discussions", new TableForeignKey({
            columnNames: ["track_item_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "track_items",
            onDelete: "CASCADE",
        }));

        await queryRunner.createForeignKey("course_discussions", new TableForeignKey({
            columnNames: ["created_by_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "CASCADE",
        }));

        await queryRunner.createTable(new Table({
            name: "course_discussion_posts",
            columns: [
                {
                    name: "id",
                    type: "uuid",
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: "uuid",
                },
                {
                    name: "discussion_id",
                    type: "uuid",
                },
                {
                    name: "author_id",
                    type: "uuid",
                },
                {
                    name: "parent_post_id",
                    type: "uuid",
                    isNullable: true,
                },
                {
                    name: "content",
                    type: "text",
                },
                {
                    name: "is_edited",
                    type: "boolean",
                    default: false,
                },
                {
                    name: "is_deleted_by_author",
                    type: "boolean",
                    default: false,
                },
                {
                    name: "created_at",
                    type: "timestamp",
                    default: "now()",
                },
                {
                    name: "updated_at",
                    type: "timestamp",
                    default: "now()",
                },
                {
                    name: "deleted_at",
                    type: "timestamp",
                    isNullable: true,
                },
            ],
        }));

        await queryRunner.createForeignKey("course_discussion_posts", new TableForeignKey({
            columnNames: ["discussion_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "course_discussions",
            onDelete: "CASCADE",
        }));

        await queryRunner.createForeignKey("course_discussion_posts", new TableForeignKey({
            columnNames: ["author_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "CASCADE",
        }));

        await queryRunner.createForeignKey("course_discussion_posts", new TableForeignKey({
            columnNames: ["parent_post_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "course_discussion_posts",
            onDelete: "CASCADE",
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("track_items", "has_discussion");
        await queryRunner.dropTable("course_discussion_posts");
        await queryRunner.dropTable("course_discussions");
    }
}
