import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, Repository } from 'typeorm';
import { SuccessResponse } from 'src/common/type/common.type';
import { SessionEventsTranslation } from '../entity/session-event-translation.entity';
import {
  CreateSessionEventTranslation,
  UpdateSessionEventTranslation,
} from '../interface/session-events-translation.interface';

@Injectable()
export class SessionEventTranslationsRepository extends Repository<SessionEventsTranslation> {
  constructor(private dataSource: DataSource) {
    super(SessionEventsTranslation, dataSource.createEntityManager());
  }

  async getSessionEventTranslationsBySessionEventId(
    sessionEventId: string,
  ): Promise<SessionEventsTranslation[] | null> {
    return await this.find({
      where: { sessionEventId: String(sessionEventId) },
    });
  }

  async createSessionEventTranslations(
    scenarioEventTranslations: CreateSessionEventTranslation[],
  ): Promise<SuccessResponse> {
    await this.save(this.create(scenarioEventTranslations));
    return {
      success: true,
    };
  }

  async updateSessionTranslations(
    scenarioEventTranslations: UpdateSessionEventTranslation[],
  ): Promise<SuccessResponse> {
    // Use a transaction to ensure all updates succeed or fail together
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      for (const translation of scenarioEventTranslations) {
        const {
          sessionEventId,
          name,
          languageId,
          message,
          branchInstruction,
          detectionData,
        } = translation;
        await transactionalEntityManager.update(
          SessionEventsTranslation,
          { sessionEventId, languageId }, // Selection criteria
          { message, branchInstruction, detectionData, name }, // Fields to update
        );
      }
    });

    return {
      success: true,
    };
  }

  async getSessionEventTranslationsByForMetaData(
    scenarioId: number,
    languageId: number,
  ) {
    const qb = this.dataSource
      .getRepository('session_events') // you can also pass SessionEvent entity class
      .createQueryBuilder('sessionEvents');

    qb.leftJoin(
      'scenario_events',
      'scenarioEvents',
      `"scenarioEvents"."eventId" = "sessionEvents"."id" AND "scenarioEvents"."deletedAt" IS NULL`,
    );

    qb.leftJoin(
      'session_events_translations',
      'sessionTranslations',
      `"sessionTranslations"."sessionEventId" = "sessionEvents"."id" AND "sessionTranslations"."languageId" = :languageId`,
    );

    qb.leftJoin(
      'scenario_events_translations',
      'scenarioTranslations',
      `"scenarioTranslations"."eventId" = "scenarioEvents"."eventId" AND "scenarioTranslations"."languageId" = :languageId`,
    );

    // SELECT list (raw aliases match your SQL)
    qb.select([
      `"sessionEvents"."createdAt" AS "sessionEvents_createdAt"`,
      `"sessionEvents"."updatedAt" AS "sessionEvents_updatedAt"`,
      `"sessionEvents"."id" AS "sessionEvents_id"`,
      `COALESCE("sessionTranslations"."name", "sessionEvents"."name") AS "sessionEvents_name"`,
      `"sessionEvents"."description" AS "sessionEvents_description"`,
      `"sessionEvents"."score" AS "sessionEvents_score"`,
      `"sessionEvents"."emoji" AS "sessionEvents_emoji"`,
      `COALESCE("sessionTranslations"."message", "sessionEvents"."message") AS "sessionEvents_message"`,
      `COALESCE("sessionTranslations"."branchInstruction", "sessionEvents"."branchInstruction") AS "sessionEvents_branchInstruction"`,
      `"sessionEvents"."detectionType" AS "sessionEvents_detectionType"`,
      `COALESCE("sessionTranslations"."detectionData", "sessionEvents"."detectionData") AS "sessionEvents_detectionData"`,
      `"sessionEvents"."visibilityType" AS "sessionEvents_visibilityType"`,
      `"sessionEvents"."deletedAt" AS "sessionEvents_deletedAt"`,
      `"sessionEvents"."eventCode" AS "sessionEvents_eventCode"`,
      `"sessionEvents"."createdBy" AS "sessionEvents_createdBy"`,
      `"sessionEvents"."updatedBy" AS "sessionEvents_updatedBy"`,
      `"scenarioEvents"."createdAt" AS "scenarioEvents_createdAt"`,
      `"scenarioEvents"."updatedAt" AS "scenarioEvents_updatedAt"`,
      `"scenarioEvents"."id" AS "scenarioEvents_id"`,
      `"scenarioEvents"."scenarioId" AS "scenarioEvents_scenarioId"`,
      `"scenarioEvents"."eventId" AS "scenarioEvents_eventId"`,
      `"scenarioEvents"."feedbackStatus" AS "scenarioEvents_feedbackStatus"`,
      `"scenarioEvents"."emoji" AS "scenarioEvents_emoji"`,
      `COALESCE("scenarioTranslations"."message", "scenarioEvents"."message") AS "scenarioEvents_message"`,
      `"scenarioEvents"."score" AS "scenarioEvents_score"`,
      `"scenarioEvents"."branchingStatus" AS "scenarioEvents_branchingStatus"`,
      `COALESCE("scenarioTranslations"."branchInstruction", "scenarioEvents"."branchInstruction") AS "scenarioEvents_branchInstruction"`,
      `"scenarioEvents"."deletedAt" AS "scenarioEvents_deletedAt"`,
      `"scenarioEvents"."autoTerminationStatus" AS "scenarioEvents_autoTerminationStatus"`,
      `"scenarioEvents"."detectionConfig" AS "scenarioEvents_detectionConfig"`,
      `"scenarioEvents"."checklistVisibilityStatus" AS "scenarioEvents_checklistVisibilityStatus"`,
    ]);

    // WHERE (grouped) and deletedAt filter
    qb.where(
      new Brackets((qbWhere) => {
        qbWhere
          .where(
            `"scenarioEvents"."scenarioId" = :scenarioId AND "sessionEvents"."visibilityType" = 'ACTIVE'`,
          )
          .orWhere(`"sessionEvents"."visibilityType" = 'PASSIVE'`);
      }),
    ).andWhere(`"sessionEvents"."deletedAt" IS NULL`);

    qb.setParameters({ scenarioId, languageId });

    // getRawMany to get the same raw rows / aliases as your SQL
    const rows = await qb.getRawMany();
    return rows;
  }
}
