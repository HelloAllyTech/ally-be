import { computeTierAssignment, TierCandidate } from '../tier-assignment.util';

const candidate = (over: Partial<TierCandidate>): TierCandidate => ({
  key: 'section',
  tokens: 100,
  score: 100,
  pinned: false,
  currentMode: 'retrieved',
  ...over,
});

describe('tier-assignment.util', () => {
  it('promotes by value density until the cap and demotes the rest', () => {
    const result = computeTierAssignment(
      [
        candidate({ key: 'dense', tokens: 100, score: 1000 }), // density 10
        candidate({
          key: 'mediocre',
          tokens: 100,
          score: 300,
          currentMode: 'always',
        }), // density 3
        candidate({
          key: 'weak',
          tokens: 100,
          score: 50,
          currentMode: 'always',
        }), // 0.5
      ],
      200,
    );
    expect(result.always.sort()).toEqual(['dense', 'mediocre']);
    expect(result.retrieved).toEqual(['weak']);
    expect(result.changes).toEqual([
      expect.objectContaining({ key: 'dense', to: 'always' }),
      expect.objectContaining({ key: 'weak', to: 'retrieved' }),
    ]);
    expect(result.tier0Tokens).toBe(200);
  });

  it('never gives Tier 0 to a zero-score section even with budget to spare', () => {
    const result = computeTierAssignment(
      [candidate({ key: 'silent', score: 0, currentMode: 'always' })],
      2000,
    );
    expect(result.retrieved).toEqual(['silent']);
  });

  it('pins win in both directions and pinned always pre-consumes budget', () => {
    const result = computeTierAssignment(
      [
        candidate({
          key: 'pinned-always',
          tokens: 150,
          score: 1, // terrible density — would be demoted if unpinned
          pinned: true,
          currentMode: 'always',
        }),
        candidate({
          key: 'pinned-retrieved',
          tokens: 10,
          score: 500, // stellar density — would be promoted if unpinned
          pinned: true,
          currentMode: 'retrieved',
        }),
        candidate({ key: 'contender', tokens: 40, score: 400 }),
      ],
      200,
    );
    expect(result.always.sort()).toEqual(['contender', 'pinned-always']);
    expect(result.retrieved).toEqual(['pinned-retrieved']);
    // Only the contender changed — pins produce no change records.
    expect(result.changes).toEqual([
      expect.objectContaining({ key: 'contender', to: 'always' }),
    ]);
    expect(result.unpinnedBudget).toBe(50);
  });

  it('a challenger within the hysteresis margin cannot displace an incumbent', () => {
    // Incumbent density 9.2 × 1.15 bonus = 10.58 beats the challenger's 10:
    // near-parity drift does not flip tiers.
    const sticky = computeTierAssignment(
      [
        candidate({ key: 'challenger', tokens: 100, score: 1000 }),
        candidate({
          key: 'incumbent',
          tokens: 100,
          score: 920,
          currentMode: 'always',
        }),
      ],
      100, // only one fits
      0.15,
    );
    expect(sticky.always).toEqual(['incumbent']);
    expect(sticky.changes).toEqual([]);

    // Beat the margin (density 12 > 10.58) and the displacement happens.
    const displaced = computeTierAssignment(
      [
        candidate({ key: 'challenger', tokens: 100, score: 1200 }),
        candidate({
          key: 'incumbent',
          tokens: 100,
          score: 920,
          currentMode: 'always',
        }),
      ],
      100,
      0.15,
    );
    expect(displaced.always).toEqual(['challenger']);
    expect(displaced.changes).toHaveLength(2);
  });

  it('promotes freely into headroom (no displacement, no flap risk)', () => {
    const result = computeTierAssignment(
      [
        candidate({
          key: 'anchor',
          tokens: 100,
          score: 1000,
          currentMode: 'always',
        }),
        candidate({ key: 'newcomer', tokens: 100, score: 905 }),
      ],
      300, // both fit
      0.15,
    );
    expect(result.always.sort()).toEqual(['anchor', 'newcomer']);
    expect(result.changes).toEqual([
      expect.objectContaining({ key: 'newcomer', to: 'always' }),
    ]);
  });

  it('is deterministic on ties', () => {
    const twice = [0, 1].map(() =>
      computeTierAssignment(
        [
          candidate({ key: 'b', tokens: 100, score: 100 }),
          candidate({ key: 'a', tokens: 100, score: 100 }),
        ],
        100,
      ),
    );
    expect(twice[0].always).toEqual(twice[1].always);
    expect(twice[0].always).toEqual(['a']);
  });
});
