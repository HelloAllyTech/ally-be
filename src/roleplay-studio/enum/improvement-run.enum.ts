export enum ImprovementRunStatus {
  /** The loop is rehearsing / critiquing / applying. */
  RUNNING = 'RUNNING',
  /** Loop finished; trainer must accept or discard the best version. */
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  /** Trainer accepted — the best version's spec became the draft. */
  ACCEPTED = 'ACCEPTED',
  /** Trainer discarded — the scratch lineage stays as archived versions. */
  DISCARDED = 'DISCARDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Why the loop stopped iterating (set alongside AWAITING_REVIEW/FAILED). */
export enum ImprovementRunOutcome {
  TARGETS_MET = 'TARGETS_MET',
  NO_PROPOSALS = 'NO_PROPOSALS',
  MAX_ROUNDS = 'MAX_ROUNDS',
  /** Best full-scope round is still the baseline — nothing beat round 0. */
  NO_IMPROVEMENT = 'NO_IMPROVEMENT',
  TIMED_OUT = 'TIMED_OUT',
  REHEARSAL_FAILED = 'REHEARSAL_FAILED',
}

export enum ImprovementRoundKind {
  /** Round 1: rehearse the untouched base version — the reference scores. */
  BASELINE = 'BASELINE',
  /** Critique → apply → rehearse (possibly cheap/targeted scope). */
  ITERATION = 'ITERATION',
  /** Full-scope re-run of a cheap round's candidate before review. */
  FINAL_VERIFICATION = 'FINAL_VERIFICATION',
}

export enum ImprovementRoundStatus {
  REHEARSING = 'REHEARSING',
  CRITIQUING = 'CRITIQUING',
  APPLYING = 'APPLYING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export const IMPROVEMENT_ACTIVE_STATUSES: ImprovementRunStatus[] = [
  ImprovementRunStatus.RUNNING,
];

export const IMPROVEMENT_END_STATUSES: ImprovementRunStatus[] = [
  ImprovementRunStatus.ACCEPTED,
  ImprovementRunStatus.DISCARDED,
  ImprovementRunStatus.FAILED,
  ImprovementRunStatus.CANCELLED,
];

export enum ImprovementEvents {
  CONNECTED = 'CONNECTED',
  JOIN_USER_IMPROVEMENTS_ROOM = 'JOIN_USER_IMPROVEMENTS_ROOM',
  JOIN_IMPROVEMENT_ROOM = 'JOIN_IMPROVEMENT_ROOM',
  IMPROVEMENTS_UPDATED = 'IMPROVEMENTS_UPDATED',
}

export enum ImprovementRoomTypes {
  USER = 'USER',
  IMPROVEMENT = 'IMPROVEMENT',
}
