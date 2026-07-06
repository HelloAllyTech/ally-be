/**
 * Which runtime engine plays a scenario.
 *
 * - SIMULATION — the original v1 studio scenario (prompt + metadata fan-out,
 *   dispatched to the default LiveKit agent).
 * - ROLEPLAY_V2 — a Roleplay Studio v2 scenario: a thin `scenarios` row whose
 *   real configuration is a versioned spec document in `roleplay_specs` /
 *   `roleplay_spec_versions`, dispatched to the dedicated roleplay agent.
 *
 * Stored as a bare varchar on `scenarios.engine` (default 'SIMULATION').
 */
export enum ScenarioEngine {
  SIMULATION = 'SIMULATION',
  ROLEPLAY_V2 = 'ROLEPLAY_V2',
}
