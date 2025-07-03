import { isNil } from 'lodash';
import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';
import { Chat } from '../../common/entities/chat.entity';

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
}
