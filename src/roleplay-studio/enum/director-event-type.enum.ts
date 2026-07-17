/**
 * SQS message types emitted by the roleplay v2 director agent on the shared
 * learn queue. The enum values ARE the wire `message_type` strings (cross-repo
 * contract with ally-ai) and double as the `eventType` discriminator stored on
 * roleplay_director_events rows.
 */
export enum RoleplayDirectorEventType {
  STATE_TRANSITION = 'director_state_transition',
  RUBRIC_SCORE = 'director_rubric_score',
  DISCLOSURE_UNLOCK = 'director_disclosure_unlock',
  STAGE_DIRECTION = 'director_stage_direction',
  SESSION_SUMMARY = 'roleplay_session_summary',
}
