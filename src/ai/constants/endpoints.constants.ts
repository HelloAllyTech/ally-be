export const ENDPOINTS = {
  SUMMARY: 'api/v1/summary/note',
  CONVERSATION: 'api/v1/conversation/analyze',
  ENHANCE: 'api/v1/summary/enhance',
  IDENTIFY_SPEAKERS: 'api/v1/conversation/identify',
  TAG_POSITIVITY_RATINGS: 'api/v1/summary/tag-positivity-ratings',
  ADD_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  SEARCH_REFERENCE_DOCUMENTS: 'api/v1/reference-documents/search',
  UPDATE_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  GET_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  DELETE_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  TRANSCRIBE_AND_SUMMARIZE: 'api/v1/transcription/transcribe-and-summarize',
  SCENARIO_REPORT_GENERATE: 'api/v1/scenario-report/generate',
  // Per-report path — append the report id at call site. ai-learn looks
  // up the in-flight ScenarioReportService and sets its cancel flag.
  SCENARIO_REPORT_CANCEL: 'api/v1/scenario-report/cancel',
  SCENARIO_EVALUATION: 'api/v1/summary/scenario/evaluate',
  // ai-learn endpoint that scores the roleplay ACTOR agent of a REAL session
  // against the superadmin-configured agent test cases (LLM judge over the
  // session transcript). Fire-and-forget; ai-learn webhooks the result back.
  ACTOR_GOAL_EVALUATION: 'api/v1/scenario-session/actor-evaluation',
} as const;
