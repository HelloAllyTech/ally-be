/**
 * Computed tier assignment (every-turn vs on-demand) — the knapsack the
 * design calls for: rank sections by expected value per token and let Tier 0
 * be the prefix that fits the cap, instead of an LLM suggestion or an
 * inherited default deciding what rides in every reply.
 *
 * Pure math, no IO: the service supplies per-section scores (term traffic in
 * the live corpus + severity-weighted error mass behind the section's rules)
 * and token costs; this module returns the assignment and the changes.
 *
 * Two stability properties:
 * - PINS win. A section an admin pinned keeps its mode unconditionally —
 *   automation amplifies judgment, it doesn't overrule it. Pinned always-
 *   sections pre-consume budget.
 * - INCUMBENT BONUS (hysteresis). Currently-always sections compete with a
 *   (1 + h) density multiplier, so a challenger must beat an incumbent by
 *   more than the hysteresis margin to displace it — no tier flapping when
 *   two sections' value drifts around parity. The cap stays a hard
 *   invariant: the knapsack never overfills regardless of incumbency.
 */

export type TierMode = 'always' | 'retrieved';

export interface TierCandidate {
  /** sectionCode, or sectionCode@profileId for overlay rows. */
  key: string;
  tokens: number;
  /** Usage (term traffic) + weighted error mass — higher = more valuable. */
  score: number;
  pinned: boolean;
  currentMode: TierMode;
}

export interface TierChange {
  key: string;
  from: TierMode;
  to: TierMode;
  density: number;
}

export interface TierAssignment {
  always: string[];
  retrieved: string[];
  changes: TierChange[];
  /** Tokens the resulting always-set consumes (incl. pinned always). */
  tier0Tokens: number;
  /** Budget the unpinned knapsack ran with (cap minus pinned always). */
  unpinnedBudget: number;
}

const density = (c: TierCandidate): number => c.score / Math.max(c.tokens, 1);

export function computeTierAssignment(
  candidates: TierCandidate[],
  cap: number,
  hysteresis = 0.15,
): TierAssignment {
  const pinned = candidates.filter((c) => c.pinned);
  const pinnedAlwaysTokens = pinned
    .filter((c) => c.currentMode === 'always')
    .reduce((sum, c) => sum + c.tokens, 0);
  const budget = Math.max(0, cap - pinnedAlwaysTokens);

  // Incumbency-weighted density: a sitting Tier 0 section must be beaten by
  // more than the hysteresis margin before it loses its slot.
  const effective = (c: TierCandidate): number =>
    density(c) * (c.currentMode === 'always' ? 1 + hysteresis : 1);

  // Deterministic order: effective density desc, then key (stable across runs).
  const unpinned = [...candidates]
    .filter((c) => !c.pinned)
    .sort((a, b) => effective(b) - effective(a) || a.key.localeCompare(b.key));

  // Greedy knapsack (sections are few and coarse enough that greedy ≈
  // optimal, and determinism matters more than the last token).
  const finalSet = new Set<string>();
  let used = 0;
  for (const c of unpinned) {
    if (c.score <= 0) continue; // zero-value sections never earn Tier 0
    if (used + c.tokens > budget) continue;
    finalSet.add(c.key);
    used += c.tokens;
  }

  const always: string[] = [];
  const retrieved: string[] = [];
  const changes: TierChange[] = [];
  let tier0Tokens = pinnedAlwaysTokens;
  for (const c of candidates) {
    const mode: TierMode = c.pinned
      ? c.currentMode
      : finalSet.has(c.key)
        ? 'always'
        : 'retrieved';
    if (mode === 'always') {
      always.push(c.key);
      if (!c.pinned) tier0Tokens += c.tokens;
    } else {
      retrieved.push(c.key);
    }
    if (!c.pinned && mode !== c.currentMode) {
      changes.push({
        key: c.key,
        from: c.currentMode,
        to: mode,
        density: density(c),
      });
    }
  }
  return { always, retrieved, changes, tier0Tokens, unpinnedBudget: budget };
}
