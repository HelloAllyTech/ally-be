/**
 * Which runtime engine plays a scenario.
 *
 * - SIMULATION — the studio scenario (prompt + metadata fan-out, dispatched to
 *   the default LiveKit agent).
 *
 * Single-valued since Roleplay Studio v2 was removed. Kept as an enum, and
 * `scenarios.engine` kept as a column, so adding a second engine later needs
 * no migration on a hot table.
 *
 * Stored as a bare varchar on `scenarios.engine` (default 'SIMULATION').
 */
export enum ScenarioEngine {
  SIMULATION = 'SIMULATION',
}
