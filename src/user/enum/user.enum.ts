export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum UserSortBy {
  NAME = 'name',
  USERNAME = 'username',
  CREATED_AT = 'createdAt',
}

/**
 * How much clinical training a learner brings, which sets the register and
 * depth of the AI supervisor's post-roleplay debrief note.
 *
 * Assigned by an org admin (learners never self-declare) and stored on
 * `users.metadata.workerType`. Absent or unrecognised values resolve to LAY —
 * plain-language feedback is the safe wrong answer, because a clinician reading
 * slightly simple feedback costs far less than a volunteer reading jargon they
 * cannot act on.
 *
 * This never moves the evaluation bar. Skill scores stay on one fixed standard
 * so they remain comparable across an organisation.
 */
export enum WorkerType {
  LAY = 'LAY',
  EARLY_PROFESSIONAL = 'EARLY_PROFESSIONAL',
  EXPERIENCED_PROFESSIONAL = 'EXPERIENCED_PROFESSIONAL',
}

export const DEFAULT_WORKER_TYPE = WorkerType.LAY;

/**
 * Read a worker type off a user's `metadata` jsonb, tolerating anything an
 * older client or a hand-edited row may have left there.
 */
export function resolveWorkerType(
  metadata?: Record<string, any> | null,
): WorkerType {
  const raw = metadata?.workerType;
  if (typeof raw !== 'string') return DEFAULT_WORKER_TYPE;
  const normalized = raw.trim().toUpperCase();
  return Object.values(WorkerType).includes(normalized as WorkerType)
    ? (normalized as WorkerType)
    : DEFAULT_WORKER_TYPE;
}

export enum ProfileImageUploadContentType {
  JPEG = 'image/jpeg',
  JPG = 'image/jpg',
  PNG = 'image/png',
}
