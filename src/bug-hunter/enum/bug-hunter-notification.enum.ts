/**
 * How loud one notification is. Stored as `character varying` with a CHECK
 * constraint, per repo convention.
 *
 * Three levels, not five, and the split is by what the reader has to DO rather
 * than by how bad it sounds — a scale where every item is "important" sorts
 * nothing. `ACTION_NEEDED` is the only one that should ever drive a badge or a
 * count: it means Bug Hunter has stopped and cannot continue without an
 * answer. `PROBLEM` is something that already went wrong and is worth knowing
 * about but isn't blocking anything. `INFO` is a completed thing worth a line
 * in the log.
 */
export enum BugHunterNotificationLevel {
  INFO = 'info',
  PROBLEM = 'problem',
  ACTION_NEEDED = 'action_needed',
}
