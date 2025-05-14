export type CallInfo = {
  callId?: string;
  clientTalkingPercentage?: number;
  counselorTalkingPercentage?: number;
  clientTalkingTime?: number;
  counselorTalkingTime?: number;
  summaryName?: string;
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
  summaryNote: SummaryNote;
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
