export enum AgentTestCaseType {
  /** Scored against a specific simulated condition (condition + pass test). */
  CONDITION = 'condition',
  /** Scored over the full session against a set of rubric rows. */
  FULL_SESSION = 'full_session',
}

export enum AgentTestCaseSortBy {
  TITLE = 'title',
  TYPE = 'type',
  CREATED_AT = 'createdAt',
}
