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
