import { ChatTypes } from '../../common/constants/chat.constants';
import { FlattenedSummaryNotePayloadCamelCase } from '../../chat/type/call.details.type';
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
    'callId',
    'callDuration',
    'callDate',
    'callTime',
    'clientId',
    'counsellor',
    'callType',
    'mode',
    'age',
    'gender',
    'profession',
    'relationshipStatus',
    'languages',
    'location',
    'codeOfConcern',
    'sessionSummary',
    'counselingProcessFlow',
    'keyConcerns',
    'subjectiveObservations',
    'objectiveObservations',
    'assessment',
    'dominantFeelings',
    'issuesWorkedOn',
    'keyTherapeuticTechniques',
    'referralsProvided',
    'homework',
    'planForNextCall',
    'tags',
    'listeningShare',
    'reflectiveQuestionsAsked',
    'openEndedQuestionsAsked',
    'emotionalLift',
    'callQuality',
    'newCallFollowUp',

    // Intake section fields
    'intakeNotes',
    'riskSelfHarm',
    'riskSelfHarmNotes',
    'riskSuicidalThoughts',
    'riskSuicidalPlan',
    'riskSuicidalAction',
    'riskSuicidalThoughtsNotes',
    'riskRunningAway',
    'riskRunningAwayNotes',
    'traumaPhysicalAbuse',
    'traumaSexualAbuse',
    'traumaVerbalAbuse',
    'traumaNeglect',
    'traumaSeparationFromCaregiverParent',
    'traumaWitnessedDomesticViolence',
    'traumaNotes',
    'assessmentPsychologicalDiagnosis',
    'assessmentPsychologicalDiagnosisNotes',
    'assessmentUseOfPsychotropicMedications',
    'assessmentUseOfPsychotropicMedicationsNotes',
    'assessmentHallucinations',
    'assessmentHallucinationsNotes',
    'assessmentAffect',
    'assessmentSpeech',

    // Ongoing Risks section fields
    'ongoingRiskSelfHarm',
    'ongoingRiskSelfHarmNotes',
    'ongoingRiskSuicidalThoughts',
    'ongoingRiskSuicidalPlan',
    'ongoingRiskSuicidalAction',
    'ongoingRiskSuicidalThoughtsNotes',
  ]);

export const DEFAULT_SUMMARY_FIELDS_ARRAY = [
  ...SUMMARY_NOTE_CONSTANT_FIELDS_ARRAY,
  ...DEFAULT_AI_SUMMARY_FIELDS_ARRAY,
];

export const DEFAULT_SUMMARY_FIELDS_SET = new Set(DEFAULT_SUMMARY_FIELDS_ARRAY);

export const DEFAULT_CHAT_TYPES = Object.values(ChatTypes);

/**
 * Chat types that are retired and can no longer be started. They stay in the
 * ChatTypes enum and in DEFAULT_CHAT_TYPES so historical HIDDEN_CHAT_TYPES
 * preferences keep validating, but they are never offered to a client.
 *
 * DICTATION_MODE — the live-mic dictation session, superseded by "Create Note".
 * Nothing about existing data changes: DICTATION chats keep their mode, their
 * transcripts, their summaries and their edit paths. Note that manual notes are
 * also stored with mode DICTATION (see ChatService.createNote), so the mode
 * itself is very much still in use — only this entry point is gone.
 */
export const DEPRECATED_CHAT_TYPES: readonly ChatTypes[] = [
  ChatTypes.DICTATION_MODE,
];

/** Chat types a tenant can actually be offered today. */
export const SELECTABLE_CHAT_TYPES = DEFAULT_CHAT_TYPES.filter(
  (type) => !DEPRECATED_CHAT_TYPES.includes(type),
);

/**
 * Names of the global_settings rows that hold editable legal page content.
 * Each row stores `{ html: string }` in its jsonb `value` column.
 */
export const LEGAL_CONTENT_NAMES = {
  TERMS: 'legal_terms',
  PRIVACY: 'legal_privacy',
} as const;
