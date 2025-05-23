import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';

export class ChatUtil {
  static isDemographicDetailsAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!summary || Object.keys(summary).length === 0) {
      return false;
    }
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
    if (!summary || Object.keys(summary).length === 0) {
      return false;
    }
    return (
      summary.dateOfSession !== null ||
      summary.newCallFollowUp !== null ||
      summary.sessionNumber !== null
    );
  }

  static isCounselorImpressionsAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!summary || Object.keys(summary).length === 0) {
      return false;
    }
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
    if (!summary || Object.keys(summary).length === 0) {
      return false;
    }
    return (
      summary.keyConcerns !== null ||
      summary.dominantFeelings !== null ||
      summary.counselingProcessFlow !== null ||
      summary.therapeuticInterventions !== null ||
      summary.issuesWorkedOn !== null ||
      summary.homework !== null
    );
  }

  static isTagsAvailable(summary?: FlattenedSummaryNotePayloadCamelCase) {
    if (!summary || Object.keys(summary).length === 0) {
      return false;
    }
    return summary?.tags?.length > 0;
  }

  static isCallQualityAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!summary || Object.keys(summary).length === 0) {
      return false;
    }
    return summary.callQuality !== null;
  }

  static isFollowUpPlanAvailable(
    summary?: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (!summary || Object.keys(summary).length === 0) {
      return false;
    }
    return (
      summary.followUpStatus !== null ||
      summary.followUpDate !== null ||
      summary.followUpGoals !== null
    );
  }
}
