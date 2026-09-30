import { XP_RULE } from '../../progress/progress.constants';

/**
 * How the "XP per Roleplay Minute" chart (AAQ-165) groups the XP ledger.
 *
 * The chart divides ALL XP by roleplay minutes, so the ratio moves for two
 * different reasons: roleplay itself paying more or less per minute (caps, the
 * engagement gate, depth milestones), or the rest of the learning portfolio —
 * track items, debrief threads, peer comments — growing or shrinking beside it.
 * The split is what lets a reader tell those apart; a single line could not.
 *
 * Grouped by `xp_events.rule`, never by `sourceType`: the launch backfill wrote
 * its rows with `sourceType = 'backfill'` but the real rule, so the rule is the
 * only column that classifies history and live awards the same way.
 */
export const XP_SOURCE_GROUPS = [
  'roleplay',
  'tracks',
  'community',
  'consistency',
  'other',
] as const;

export type XpSourceGroup = (typeof XP_SOURCE_GROUPS)[number];

/**
 * Rule → group. Anything missing (a retired rule, or one added later without
 * updating this map) lands in `other`, so the stack still sums to the total
 * rather than silently dropping XP.
 */
export const XP_SOURCE_GROUP_BY_RULE: Readonly<Record<string, XpSourceGroup>> =
  {
    [XP_RULE.PRACTICE_MINUTE]: 'roleplay',
    [XP_RULE.SESSION_COMPLETED]: 'roleplay',
    [XP_RULE.DAILY_DEPTH_MILESTONE]: 'roleplay',
    [XP_RULE.TRACK_ITEM_COMPLETED]: 'tracks',
    [XP_RULE.DEBRIEF_THREAD]: 'community',
    [XP_RULE.PEER_COMMENT]: 'community',
    [XP_RULE.WEEKLY_CONSISTENCY]: 'consistency',
  };

export const XP_SOURCE_GROUP_LABELS: Readonly<Record<XpSourceGroup, string>> = {
  roleplay: 'Roleplay',
  tracks: 'Track items',
  community: 'Debriefs & peer comments',
  consistency: 'Weekly consistency',
  other: 'Retired rules',
};

export const XP_SOURCE_GROUP_DESCRIPTIONS: Readonly<
  Record<XpSourceGroup, string>
> = {
  roleplay:
    'Practice minutes, session completion and daily depth milestones — XP the ' +
    'roleplay itself pays.',
  tracks:
    'Completed track items (quizzes, cases, journals, videos, articles, games). ' +
    'Roleplay track items pay 0, since their session already pays.',
  community: 'Debrief threads and comments on peers’ sessions.',
  consistency: 'The weekly consistency bonus.',
  other:
    'Rules no longer written (streak multiplier, skill personal best), kept so ' +
    'historical totals still add up.',
};
