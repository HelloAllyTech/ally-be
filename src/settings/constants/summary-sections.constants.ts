export type SummarySectionField = { id: string; label: string };

export type SummarySection = {
  id: string;
  label: string;
  defaultVisibility: boolean;
  fields: readonly SummarySectionField[];
};

export const SUMMARY_SECTIONS: readonly SummarySection[] = [
  {
    id: 'other',
    label: 'Other',
    defaultVisibility: true,
    fields: [
      { id: 'callId', label: 'Call ID' },
      { id: 'callDuration', label: 'Call Duration (seconds)' },
      { id: 'callDate', label: 'Call Date' },
      { id: 'callTime', label: 'Call Time' },
      { id: 'clientId', label: 'Client ID' },
      { id: 'counsellor', label: 'Counselor' },
      { id: 'callType', label: 'Call Type' },
      { id: 'callQuality', label: 'Call Quality' },
      { id: 'newCallFollowUp', label: 'New Call Follow-up' },
      { id: 'mode', label: 'Mode' },
    ],
  },
  {
    id: 'demographics',
    label: 'Demographic Details',
    defaultVisibility: true,
    fields: [
      { id: 'age', label: 'Age' },
      { id: 'gender', label: 'Gender' },
      { id: 'location', label: 'Location' },
      { id: 'profession', label: 'Profession' },
      { id: 'relationshipStatus', label: 'Relationship Status' },
      { id: 'languages', label: 'Languages' },
      { id: 'codeOfConcern', label: 'Code of Concern' },
    ],
  },
  {
    id: 'session',
    label: 'Session Documentation',
    defaultVisibility: true,
    fields: [
      { id: 'sessionSummary', label: 'Session Summary' },
      { id: 'counselingProcessFlow', label: 'Counseling Process Flow' },
      { id: 'keyConcerns', label: 'Key Concerns' },
      { id: 'subjectiveObservations', label: 'Subjective Observations' },
      { id: 'objectiveObservations', label: 'Objective Observations' },
      { id: 'assessment', label: 'Assessment' },
      { id: 'dominantFeelings', label: 'Dominant Feelings' },
      { id: 'issuesWorkedOn', label: 'Issues Worked On' },
      { id: 'keyTherapeuticTechniques', label: 'Key Therapeutic Techniques' },
      { id: 'referralsProvided', label: 'Referrals Provided' },
      { id: 'homework', label: 'Homework' },
      { id: 'planForNextCall', label: 'Plan for Next Call' },
      { id: 'tags', label: 'Tags' },
    ],
  },
  {
    id: 'metrics',
    label: 'Metrics',
    defaultVisibility: true,
    fields: [
      { id: 'listeningShare', label: 'Listening Share' },
      { id: 'reflectiveQuestionsAsked', label: 'Reflective Questions Asked' },
      { id: 'openEndedQuestionsAsked', label: 'Open-ended Questions Asked' },
      { id: 'emotionalLift', label: 'Emotional Lift' },
    ],
  },
  {
    id: 'intake',
    label: 'Intake',
    defaultVisibility: false,
    fields: [
      { id: 'intakeNotes', label: 'Intake Notes' },
      { id: 'riskSelfHarm', label: 'Risk, Self Harm' },
      { id: 'riskSelfHarmNotes', label: 'Risk, Self Harm Notes' },
      { id: 'riskSuicidalThoughts', label: 'Risk, Suicidal Thoughts' },
      { id: 'riskSuicidalPlan', label: 'Risk, Suicidal Plan' },
      { id: 'riskSuicidalAction', label: 'Risk, Suicidal Action' },
      {
        id: 'riskSuicidalThoughtsNotes',
        label: 'Risk, Suicidal Thoughts Notes',
      },
      { id: 'riskRunningAway', label: 'Risk, Running Away' },
      { id: 'riskRunningAwayNotes', label: 'Risk, Running Away Notes' },
      { id: 'traumaPhysicalAbuse', label: 'Trauma, Physical Abuse' },
      { id: 'traumaSexualAbuse', label: 'Trauma, Sexual Abuse' },
      { id: 'traumaVerbalAbuse', label: 'Trauma, Verbal Abuse' },
      { id: 'traumaNeglect', label: 'Trauma, Neglect' },
      {
        id: 'traumaSeparationFromCaregiverParent',
        label: 'Trauma, Separation from Caregiver/Parent',
      },
      {
        id: 'traumaWitnessedDomesticViolence',
        label: 'Trauma, Witnessed Domestic Violence',
      },
      { id: 'traumaNotes', label: 'Trauma, Notes' },
      {
        id: 'assessmentPsychologicalDiagnosis',
        label: 'Assessment, Psychological Diagnosis',
      },
      {
        id: 'assessmentPsychologicalDiagnosisNotes',
        label: 'Assessment, Psychological Diagnosis Notes',
      },
      {
        id: 'assessmentUseOfPsychotropicMedications',
        label: 'Assessment, Use of Psychotropic Medications',
      },
      {
        id: 'assessmentUseOfPsychotropicMedicationsNotes',
        label: 'Assessment, Use of Psychotropic Medications Notes',
      },
      { id: 'assessmentHallucinations', label: 'Assessment, Hallucinations' },
      {
        id: 'assessmentHallucinationsNotes',
        label: 'Assessment, Hallucinations Notes',
      },
      { id: 'assessmentAffect', label: 'Assessment, Affect' },
      { id: 'assessmentSpeech', label: 'Assessment, Speech' },
    ],
  },
  {
    id: 'ongoingRisks',
    label: 'Risk Assessment',
    defaultVisibility: false,
    fields: [
      { id: 'ongoingRiskSelfHarm', label: 'Ongoing Risk, Self Harm' },
      {
        id: 'ongoingRiskSelfHarmNotes',
        label: 'Ongoing Risk, Self Harm Notes',
      },
      {
        id: 'ongoingRiskSuicidalThoughts',
        label: 'Ongoing Risk, Suicidal Thoughts',
      },
      { id: 'ongoingRiskSuicidalPlan', label: 'Ongoing Risk, Suicidal Plan' },
      {
        id: 'ongoingRiskSuicidalAction',
        label: 'Ongoing Risk, Suicidal Action',
      },
      {
        id: 'ongoingRiskSuicidalThoughtsNotes',
        label: 'Ongoing Risk, Suicidal Thoughts Notes',
      },
    ],
  },
];

export const SUMMARY_FIELD_IDS_FROM_MASTER: string[] = SUMMARY_SECTIONS.flatMap(
  (section) => section.fields.map((field) => field.id),
);

export const SECTION_ID_TO_FIELD_IDS: Record<string, readonly string[]> =
  Object.fromEntries(
    SUMMARY_SECTIONS.map((section) => [
      section.id,
      section.fields.map((field) => field.id),
    ]),
  );

export const SUMMARY_FIELD_ID_TO_LABEL: Record<string, string> =
  Object.fromEntries(
    SUMMARY_SECTIONS.flatMap((section) =>
      section.fields.map((field) => [field.id, field.label]),
    ),
  );

export const SUMMARY_SECTION_IDS = SUMMARY_SECTIONS.map(
  (section) => section.id,
);

export const DEFAULT_HIDDEN_SECTION_IDS: readonly string[] =
  SUMMARY_SECTIONS.filter((section) => !section.defaultVisibility).map(
    (section) => section.id,
  );
