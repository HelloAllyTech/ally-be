import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';
function defineAllFields<T>() {
  return <K extends (keyof T)[]>(
    keys: [...K] &
      ([keyof T] extends [K[number]]
        ? [K[number]] extends [keyof T]
          ? [...K]
          : never
        : never),
  ) => keys;
}

export const DEFAULT_SUMMARY_FIELDS_ARRAY =
  defineAllFields<FlattenedSummaryNotePayloadCamelCase>()([
    'dateOfSession',
    'newCallFollowUp',
    'sessionNumber',
    'counselorName',

    'clientId',
    'gender',
    'age',
    'location',
    'workingStatus',
    'anyFormalDiagnosis',
    'codeOfConcern',

    'keyConcerns',
    'dominantFeelings',

    'counselingProcessFlow',
    'therapeuticInterventions',
    'issuesWorkedOn',
    'homework',

    'followUpStatus',
    'followUpDate',
    'followUpGoals',

    'clientAttitude',
    'emotionalStateStart',
    'emotionalStateChange',
    'problemAnalysis',
    'additionalInsights',
    'counselorFeelings',

    'tags',
    'callQuality',
  ]);
export const DEFAULT_SUMMARY_FIELDS_SET = new Set(DEFAULT_SUMMARY_FIELDS_ARRAY);
