import * as fs from 'fs';

/**
 * TypeORM orders migrations by the numeric timestamp in the filename, so two
 * sharing one have no defined order between them. Whichever runs second may
 * depend on the first, and the order can differ between a fresh database and an
 * existing one.
 *
 * Duplicates come from branching, not carelessness: two people generate a
 * migration on the same day, both land, and neither PR could see the other.
 * Scoped to one known pair, a guard can only catch the collision that already
 * happened — so this checks every migration.
 *
 * It cannot demand that NO duplicates exist. Twenty pairs already do, and
 * renumbering a merged migration is forbidden: it has already run, and its
 * name is its identity in the `migrations` table. They are grandfathered by
 * the high-water mark below, which is the honest shape of the rule — the past
 * is unfixable, the future is not allowed to repeat it.
 */
describe('migration timestamps', () => {
  /**
   * Highest timestamp involved in a pre-existing collision. Every duplicate at
   * or below this is a merged pair that cannot be renumbered; any duplicate
   * above it is new, and belongs to a branch that can still be fixed.
   *
   * Only ever lower this. Raising it to make a failure go away grandfathers the
   * very collision this test exists to catch.
   */
  const LEGACY_COLLISION_WATERMARK = 1944400000000;

  const timestampOf = (file: string) => file.match(/^(\d+)-/)?.[1];

  const files = fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));

  const collisions = () => {
    const byTimestamp = new Map<string, string[]>();
    for (const file of files) {
      const timestamp = timestampOf(file);
      if (!timestamp) continue;
      byTimestamp.set(timestamp, [...(byTimestamp.get(timestamp) ?? []), file]);
    }
    return [...byTimestamp.entries()].filter(([, group]) => group.length > 1);
  };

  it('gives every new migration a timestamp no other migration uses', () => {
    // The fix when this fails: renumber the migration that is NOT yet merged,
    // above the highest timestamp on master. The failure names both files so
    // it is obvious which is which.
    const offenders = collisions()
      .filter(([timestamp]) => Number(timestamp) > LEGACY_COLLISION_WATERMARK)
      .map(([timestamp, group]) => `${timestamp}: ${group.join(', ')}`);

    expect(offenders).toEqual([]);
  });

  it('keeps the CreateAnalyticsChartPreferences / GlossaryGenerationPromptV3 pair apart', () => {
    // The original collision this file was written for, kept as a named
    // regression so a future renumbering cannot quietly reintroduce it.
    const analytics = files.find((f) =>
      f.includes('CreateAnalyticsChartPreferences'),
    );
    const glossary = files.find((f) =>
      f.includes('GlossaryGenerationPromptV3'),
    );

    expect(analytics).toBeDefined();
    expect(glossary).toBeDefined();
    expect(timestampOf(analytics as string)).not.toEqual(
      timestampOf(glossary as string),
    );
  });

  it('does not let the watermark drift above the collisions it grandfathers', () => {
    // Keeps the escape hatch honest. If the legacy pairs are ever renumbered
    // away, this fails and the watermark should come DOWN — otherwise it
    // silently starts excusing new collisions it was never meant to cover.
    const highestLegacy = collisions()
      .map(([timestamp]) => Number(timestamp))
      .filter((timestamp) => timestamp <= LEGACY_COLLISION_WATERMARK)
      .sort((a, b) => b - a)[0];

    expect(highestLegacy).toBe(LEGACY_COLLISION_WATERMARK);
  });

  it('names every migration <timestamp>-<Name>.ts', () => {
    // A file the regex cannot read is one TypeORM cannot order either, and it
    // would slip past the duplicate check by having no timestamp at all.
    expect(files.filter((file) => !timestampOf(file))).toEqual([]);
  });
});
