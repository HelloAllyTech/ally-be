import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';

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
      summary.age !== null ||
      summary.gender !== null ||
      summary.location !== null ||
      summary.workingStatus !== null ||
      summary.anyFormalDiagnosis !== null ||
      summary.codeOfConcern !== null
    );
  }

  static isSessionDetailsAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      summary.dateOfSession !== null ||
      summary.newCallFollowUp !== null ||
      summary.sessionNumber !== null
    );
  }

  static isCounselorImpressionsAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      summary.clientAttitude !== null ||
      summary.emotionalStateStart !== null ||
      summary.emotionalStateChange !== null ||
      summary.problemAnalysis !== null ||
      summary.additionalInsights !== null ||
      summary.counselorFeelings !== null
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
    return summary.callQuality !== null;
  }

  static isFollowUpPlanAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!this.isValidSummary(summary)) return false;
    return (
      summary.followUpStatus !== null ||
      summary.followUpDate !== null ||
      summary.followUpGoals !== null
    );
  }
}
