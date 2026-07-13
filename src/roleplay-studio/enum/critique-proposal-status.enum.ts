export enum CritiqueProposalStatus {
  /** Returned by the critic; awaiting a trainer or auto-improve decision. */
  PROPOSED = 'PROPOSED',
  /** Applied to a spec version (appliedInVersionId set). */
  APPLIED = 'APPLIED',
  /** Explicitly declined by the trainer. */
  REJECTED = 'REJECTED',
  /** The ops did not apply cleanly / produced an invalid spec — never surfaced. */
  SKIPPED_INVALID = 'SKIPPED_INVALID',
  /** Applied and the next rehearsal confirmed its expectedEffect. */
  VERIFIED = 'VERIFIED',
  /** Applied but the next rehearsal contradicted its expectedEffect. */
  FAILED_VERIFICATION = 'FAILED_VERIFICATION',
}

export const CRITIQUE_PROPOSAL_DECIDED_STATUSES: CritiqueProposalStatus[] = [
  CritiqueProposalStatus.APPLIED,
  CritiqueProposalStatus.REJECTED,
  CritiqueProposalStatus.VERIFIED,
  CritiqueProposalStatus.FAILED_VERIFICATION,
];
