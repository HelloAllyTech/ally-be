export enum RehearsalStatus {
  // Row created; the run request to ally-ai-learn is in flight.
  STARTED = 'STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum RehearsalEvents {
  CONNECTED = 'CONNECTED',
  JOIN_USER_REHEARSALS_ROOM = 'JOIN_USER_REHEARSALS_ROOM',
  JOIN_REHEARSAL_ROOM = 'JOIN_REHEARSAL_ROOM',
  REHEARSALS_UPDATED = 'REHEARSALS_UPDATED',
}

export enum RehearsalRoomTypes {
  USER = 'USER',
  REHEARSAL = 'REHEARSAL',
}

export enum RehearsalTraineeProfile {
  SKILLED = 'SKILLED',
  POOR = 'POOR',
  ADVERSARIAL = 'ADVERSARIAL',
}
