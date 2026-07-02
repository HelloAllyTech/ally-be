import { FlattenedSummaryNotePayloadCamelCase } from '../../chat/type/call.details.type';
import { LANGUAGE_MAP } from '../../chat/constants/chat.constants';

/**
 * One formatter per `extractFromAiResponseKey`, converting a raw value from
 * the fixed-schema AI response (FlattenedSummaryNotePayloadCamelCase) into
 * the plain string ChatCustomFieldValue.value expects. `languages` mirrors
 * chat-summary.service.ts's formatLanguages() exactly, so a migrated
 * tenant's custom field shows the same text the export always has.
 */
const EXTRACTED_AI_FIELD_FORMATTERS: Record<
  string,
  (response: FlattenedSummaryNotePayloadCamelCase) => string | null
> = {
  callType: (response) => response.callType ?? null,
  languages: (response) =>
    response.languages?.length
      ? response.languages
          .map(({ language, percentage }) => {
            const label =
              LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP] ?? language;
            return `${label} (${percentage.toFixed(1)}%)`;
          })
          .join(', ')
      : null,
  reflectiveQuestionsAsked: (response) =>
    response.reflectiveQuestionsAsked != null
      ? response.reflectiveQuestionsAsked.toString()
      : null,
  openEndedQuestionsAsked: (response) =>
    response.openEndedQuestionsAsked != null
      ? response.openEndedQuestionsAsked.toString()
      : null,
  emotionalLift: (response) => response.emotionalLift ?? null,
  callQuality: (response) =>
    response.callQuality != null ? response.callQuality.toString() : null,
};

export function formatExtractedAiFieldValue(
  extractFromAiResponseKey: string,
  response: FlattenedSummaryNotePayloadCamelCase,
): string | null {
  const formatter = EXTRACTED_AI_FIELD_FORMATTERS[extractFromAiResponseKey];
  return formatter ? formatter(response) : null;
}
