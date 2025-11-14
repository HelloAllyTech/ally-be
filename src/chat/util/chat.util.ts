import { isNil } from 'lodash';
import { FlattenedSummaryNotePayloadCamelCase } from '../type/call.details.type';
import { Chat } from '../entity/chat.entity';

export class ChatUtil {
  private static isValidSummary(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ): summary is FlattenedSummaryNotePayloadCamelCase {
    return (
      summary !== undefined &&
      summary !== null &&
      Object.keys(summary).length > 0
    );
  }

  static isDemographicDetailsAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      !isNil(summary.age) ||
      !isNil(summary.gender) ||
      !isNil(summary.location) ||
      !isNil(summary.relationshipStatus) ||
      !isNil(summary.profession) ||
      !isNil(summary.codeOfConcern) ||
      !isNil(summary.languages)
    );
  }

  static isTagsAvailable(summary?: FlattenedSummaryNotePayloadCamelCase) {
    if (!this.isValidSummary(summary)) return false;
    return summary?.tags?.length > 0;
  }

  static isCallQualityAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return !isNil(summary.callQuality);
  }
  static getSummaryName(chat: Chat) {
    const startedAt = new Date(chat.startedAt ?? chat.createdAt);
    const date = startedAt.toISOString().split('T')[0];
    return `CALL-${chat.id}-${date}`;
  }
  static getCallDurationInSeconds(startDate: Date, endDate: Date) {
    return startDate && endDate
      ? Math.max(
          0,
          Math.floor(
            (new Date(endDate).getTime() - new Date(startDate).getTime()) /
              1000,
          ),
        )
      : 0;
  }
}
