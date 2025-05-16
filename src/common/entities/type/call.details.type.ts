export type CallInfo = {
  callId?: string;
  clientTalkingPercentage?: number;
  counselorTalkingPercentage?: number;
  clientTalkingTime?: number;
  counselorTalkingTime?: number;
  summaryName?: string;
  pauseNudge?: boolean;
};

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
export type SummaryDetails = {
  summaryNote: SummaryNoteV2;
  tags: string[];
  callQuality: number;
};

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

export type SummaryNoteV2 = {
  session_details: {
    date_of_session: string;
    new_call_follow_up: NewCallFollowUp;
    session_number: string | null;
    counselor_name: string;
  };
  demographic_details: {
    client_id: string | null;
    gender: Gender;
    age: number | null;
    location: string | null;
    working_status: WorkingStatus;
    any_formal_diagnosis: string | null;
    code_of_concern: string | null;
  };
  session_documentation: {
    key_concerns: string[];
    dominant_feelings: string[];
    work_done: {
      counseling_process_flow: string[];
      therapeutic_interventions: string[];
      issues_worked_on: string[];
      homework: string[];
      follow_up_plan: {
        status: FollowUpStatus;
        follow_up_date: string | null;
        goals: string[];
      };
    };
  };
  counselor_impressions: {
    client_attitude: string;
    emotional_state_start: string | null;
    emotional_state_change: string | null;
    problem_analysis: string;
    additional_insights: string | null;
    counselor_feelings: string;
  };
  tags: string[];
  call_quality: number;
};
