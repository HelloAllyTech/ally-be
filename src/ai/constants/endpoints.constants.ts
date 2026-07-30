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
  // Roleplay Studio v2 Improve test runs. ai-learn keeps its internal
  // "rehearsal" naming for these routes; ally-be calls them test runs.
  // Answers 202; progress/results come back via the test-run webhook
  // (PATCH /v1/roleplay-studio/test-runs/webhook/:runId).
  ROLEPLAY_TEST_RUN_RUN: 'api/v1/roleplay-rehearsal/run',
  // Per-run path — append the run id at call site.
  ROLEPLAY_TEST_RUN_CANCEL: 'api/v1/roleplay-rehearsal/cancel',
  // Product Roadmap semantic duplicate detection. ally-ai owns the
  // `RoadmapOpportunity` Weaviate collection; ally-be's Postgres stays the
  // system of record and treats the vector store as a DERIVED index. The
  // Weaviate object uuid IS the roadmap_opportunities.id, so there is no
  // separate id property to keep in sync.
  // Upsert/delete take the opportunity id appended to the path.
  ROADMAP_OPPORTUNITY_UPSERT: 'api/v1/roadmap-opportunities',
  ROADMAP_OPPORTUNITY_DELETE: 'api/v1/roadmap-opportunities',
  ROADMAP_OPPORTUNITY_SEARCH: 'api/v1/roadmap-opportunities/search',
  ROADMAP_OPPORTUNITY_BULK_UPSERT: 'api/v1/roadmap-opportunities/bulk-upsert',
  ROADMAP_OPPORTUNITY_IDS: 'api/v1/roadmap-opportunities/ids',
} as const;
