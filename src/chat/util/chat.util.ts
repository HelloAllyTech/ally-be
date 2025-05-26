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
      !isNil(summary.workingStatus) ||
      !isNil(summary.anyFormalDiagnosis) ||
      !isNil(summary.codeOfConcern)
    );
  }

  static isSessionDetailsAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      !isNil(summary.dateOfSession) ||
      !isNil(summary.newCallFollowUp) ||
      !isNil(summary.sessionNumber)
    );
  }

  static isCounselorImpressionsAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      !isNil(summary.clientAttitude) ||
      !isNil(summary.emotionalStateStart) ||
      !isNil(summary.emotionalStateChange) ||
      !isNil(summary.problemAnalysis) ||
      !isNil(summary.additionalInsights) ||
      !isNil(summary.counselorFeelings)
    );
  }

  static isSessionDocumentationAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      summary.keyConcerns?.length ||
      summary.dominantFeelings?.length ||
      summary.counselingProcessFlow?.length ||
      summary.therapeuticInterventions?.length ||
      summary.issuesWorkedOn?.length ||
      summary.homework?.length
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

  static isFollowUpPlanAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      !isNil(summary.followUpStatus) ||
      !isNil(summary.followUpDate) ||
      !isNil(summary.followUpGoals)
    );
  }
  static getSummaryName(chat: Chat) {
    const startedAt = new Date(chat.startedAt ?? chat.createdAt);
    const date = startedAt.toISOString().split('T')[0];
    return `CALL-${chat.id}-${date}`;
  }
}
