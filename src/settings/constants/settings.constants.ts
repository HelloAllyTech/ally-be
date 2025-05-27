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

export type SummaryNoteConstantFields = {
  callId: string;
  callDuration: number;
  callDate: string;
  callTime: string;
  clientId: string;
  language: string;
  listeningShare: number;
};

export const SUMMARY_NOTE_CONSTANT_FIELDS_ARRAY =
  defineAllFields<SummaryNoteConstantFields>()([
    'callId',
    'callDuration',
    'callDate',
    'callTime',
    'clientId',
    'language',
    'listeningShare',
  ]);

export const DEFAULT_AI_SUMMARY_FIELDS_ARRAY =
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

    'emotionalLift',
    'reflectiveQuestionsAsked',
    'listeningShare',
  ]);

export const DEFAULT_SUMMARY_FIELDS_ARRAY = [
  ...SUMMARY_NOTE_CONSTANT_FIELDS_ARRAY,
  ...DEFAULT_AI_SUMMARY_FIELDS_ARRAY,
];

export const DEFAULT_SUMMARY_FIELDS_SET = new Set(DEFAULT_SUMMARY_FIELDS_ARRAY);
