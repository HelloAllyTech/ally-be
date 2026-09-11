/**
 * Whether a skill category reads as shown, shown but weak, or too thin on
 * evidence to say either way. See TRACK_PROGRESS_MIN_SKILL_SAMPLE and
 * TRACK_PROGRESS_SKILL_DEMONSTRATED_PCT in track.constant.ts for the exact
 * rule.
 */
export type SkillFeedbackClassification =
  | 'demonstrated'
  | 'needs_practice'
  | 'insufficient_data';

export interface TrackProgressSectionSummary {
  id: string;
  title: string;
  order: number;
  completedItems: number;
  totalItems: number;
}

/**
 * One skillCoverage category, averaged across every evaluated ROLEPLAY
 * session in this course. `category` is a raw pass-through string: both
 * label generations (`Listening Engagement…` from ally-ai, the legacy
 * `Learning`/`Support`/`Standards` set) can appear in real data, exactly as
 * SkillGrowthAnalyticsRepository.parseSkillCoverage already treats them —
 * unnormalised.
 */
export interface TrackSkillCategoryFeedback {
  category: string;
  averagePercentage: number | null;
  /** Occurrences of this category across the course's evaluated sessions. */
  sampleSize: number;
  classification: SkillFeedbackClassification;
}

/**
 * One completed, evaluated roleplay attempt in this course — enough to
 * deep-link out to the existing per-session report page rather than
 * re-showing evaluationMarkdown here.
 */
export interface TrackRoleplaySessionFeedback {
  trackItemId: string;
  trackItemTitle: string | null;
  scenarioSessionId: string;
  compositeScore: number | null;
  occurredAt: string | null;
  /** Human-readable judge feedback for this session (markdown). */
  evaluationMarkdown: string | null;
}

export interface TrackProgressDashboard {
  trackId: string;
  title: string;
  trackEnrollmentId: string;
  totalItems: number;
  completedItems: number;
  completionPct: number;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  sections: TrackProgressSectionSummary[];
  evaluatedRoleplaySessionCount: number;
  averageCompositeScore: number | null;
  skillCategories: TrackSkillCategoryFeedback[];
  roleplaySessions: TrackRoleplaySessionFeedback[];
}
