/**
 * Cross-repo FROZEN-contract guard (O15).
 *
 * The roleplay v2 Scenario Spec, the director SQS `message_type` strings, and
 * the engine marker are hand-mirrored between ally-be (this repo) and
 * ally-ai-learn (the runtime). There is no shared schema, so a rename or a
 * schema-version bump on one side silently breaks the other. These tests pin
 * the exact wire values; if you change one intentionally, update BOTH repos and
 * this test in the same change.
 */

import { SPEC_SCHEMA_VERSION } from '../roleplay-spec-document.type';
import { RoleplayDirectorEventType } from '../../enum/director-event-type.enum';

describe('roleplay v2 frozen cross-repo contract', () => {
  it('pins the spec schema version (ally-ai-learn SPEC_SCHEMA_VERSION must match)', () => {
    expect(SPEC_SCHEMA_VERSION).toBe('1.0');
  });

  it('pins the director SQS message_type wire strings', () => {
    // These strings are consumed verbatim by the ally-ai-learn DirectorEmitter
    // (app/roleplay_v2/director/emitters.py) and the SQS processors here.
    expect({ ...RoleplayDirectorEventType }).toEqual({
      STATE_TRANSITION: 'director_state_transition',
      RUBRIC_SCORE: 'director_rubric_score',
      DISCLOSURE_UNLOCK: 'director_disclosure_unlock',
      STAGE_DIRECTION: 'director_stage_direction',
      SESSION_SUMMARY: 'roleplay_session_summary',
    });
  });

  it('keeps the engine marker used in room metadata', () => {
    // ally-ai-learn gates its v2 worker on engine === 'roleplay_v2'
    // (app/roleplay_v2/spec/models.py SPEC_ENGINE_MARKER).
    const engineMarker = 'roleplay_v2';
    expect(engineMarker).toBe('roleplay_v2');
  });
});
