import { Pagination } from 'src/common/type/common.type';
import { FieldFilter } from '../dto/call-log.request.dto';

export enum NewCallFollowUp {
  NEW_CALL = 'New Call',
  FOLLOW_UP = 'Follow-Up',
}

export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
  OTHER = 'Other',
}

export enum WorkingStatus {
  WORKING = 'Working',
  NOT_WORKING = 'Not Working',
  STUDENT = 'Student',
  RETIRED = 'Retired',
}

export enum FollowUpStatus {
  SCHEDULED = 'Scheduled',
  NOT_SCHEDULED = 'Not Scheduled',
}

export type SummaryNote = {
  sessionDetails: {
    dateOfSession: string;
    newCallFollowUp: NewCallFollowUp;
    sessionNumber: string;
    counselorName: string;
  };
  demographicDetails: {
    clientId: string | null;
    gender: Gender;
    age: number;
    location: string;
    workingStatus: WorkingStatus;
    anyFormalDiagnosis: string | null;
    codeOfConcern: string;
  };
  sessionDocumentation: {
    keyConcerns: string[];
    dominantFeelings: string[];
    workDone: {
      counselingProcessFlow: string[];
      therapeuticInterventions: string[];
      issuesWorkedOn: string[];
      homework: string[];
      followUpPlan: {
        status: FollowUpStatus;
        followUpDate: string | null;
        goals: string[];
      };
    };
  };
  counselorImpressions: {
    clientAttitude: string;
    emotionalStateStart: string;
    emotionalStateChange: string;
    problemAnalysis: string;
    additionalInsights: string;
    counselorFeelings: string;
  };
  tags: string[];
  callQuality: number;
};

export type Tag = {
  tag: string;
  positivity_rating: number;
};

export type Language = {
  language: string;
  percentage: number;
};

export type FlattenedSummaryNotePayload = {
  call_id: string | null;
  call_duration: number | null;
  call_date: string;
  call_time: string | null;
  client_id: string | null;
  counsellor: string | null;
  call_type: string | null;
  age: number | null;
  gender: string;
  profession: string | null;
  relationship_status: string | null;
  languages: Language[];
  location: string | null;
  code_of_concern: string;
  session_summary: string;
  counseling_process_flow: string | null;
  key_concerns: string;
  subjective_observations: string;
  objective_observations: string;
  assessment: string;
  dominant_feelings: string;
  issues_worked_on: string;
  key_therapeutic_techniques: string;
  referrals_provided: string | null;
  homework: string;
  plan_for_next_call: string;
  tags: Tag[];
  listening_share: number | null;
  reflective_questions_asked: number;
  open_ended_questions_asked: number;
  emotional_lift: string;
  call_quality: number;
  mode?: string | null;
};

export type FlattenedSummaryNotePayloadCamelCase = {
  callId: string | null;
  callDuration: number | null;
  callDate: string;
  callTime: string | null;
  clientId: string | null;
  counsellor: string | null;
  callType: string | null;
  age: number | null;
  gender: string;
  profession: string | null;
  relationshipStatus: string | null;
  languages: Language[];
  location: string | null;
  codeOfConcern: string;
  sessionSummary: string;
  counselingProcessFlow: string | null;
  keyConcerns: string;
  subjectiveObservations: string;
  objectiveObservations: string;
  assessment: string;
  dominantFeelings: string;
  issuesWorkedOn: string;
  keyTherapeuticTechniques: string;
  referralsProvided: string | null;
  homework: string;
  planForNextCall: string;
  tags: Tag[];
  listeningShare: number | null;
  reflectiveQuestionsAsked: number;
  openEndedQuestionsAsked: number;
  emotionalLift: string;
  callQuality: number;
  newCallFollowUp: string;
  mode?: string | null;

  // Intake section fields
  intakeNotes?: string | null;
  riskSelfHarm?: string | null;
  riskSelfHarmNotes?: string | null;
  riskSuicidalThoughts?: string | null;
  riskSuicidalPlan?: string | null;
  riskSuicidalAction?: string | null;
  riskSuicidalThoughtsNotes?: string | null;
  riskRunningAway?: string | null;
  riskRunningAwayNotes?: string | null;
  traumaPhysicalAbuse?: string | null;
  traumaSexualAbuse?: string | null;
  traumaVerbalAbuse?: string | null;
  traumaNeglect?: string | null;
  traumaSeparationFromCaregiverParent?: string | null;
  traumaWitnessedDomesticViolence?: string | null;
  traumaNotes?: string | null;
  assessmentPsychologicalDiagnosis?: string | null;
  assessmentPsychologicalDiagnosisNotes?: string | null;
  assessmentUseOfPsychotropicMedications?: string | null;
  assessmentUseOfPsychotropicMedicationsNotes?: string | null;
  assessmentHallucinations?: string | null;
  assessmentHallucinationsNotes?: string | null;
  assessmentAffect?: string | null;
  assessmentSpeech?: string | null;

  // Ongoing Risks section fields
  ongoingRiskSelfHarm?: string | null;
  ongoingRiskSelfHarmNotes?: string | null;
  ongoingRiskSuicidalThoughts?: string | null;
  ongoingRiskSuicidalPlan?: string | null;
  ongoingRiskSuicidalAction?: string | null;
  ongoingRiskSuicidalThoughtsNotes?: string | null;
};

export interface CallLogsParams extends Pagination {
  counselorId: number;
  tenantId: string;
  archive?: string;
  callName?: string;
  fieldFilters?: FieldFilter[];
  // Built-in column filters (mirror the relevant CallLogFilters fields).
  startDate?: string;
  endDate?: string;
  minDuration?: number;
  maxDuration?: number;
  tags?: string;
  mode?: string;
  status?: string;
  source?: string;
}
