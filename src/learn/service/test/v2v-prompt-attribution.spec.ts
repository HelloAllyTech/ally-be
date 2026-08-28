/**
 * V2V sessions must record which main-agent prompt ran.
 *
 * They are the sessions deliberately generated to COMPARE prompts, and they
 * were the one population that could not be attributed to one:
 * `startScenarioSession` captured `selectedMainPromptCode`,
 * `startV2VTestSession` did not, so every A/B run landed in the analytics
 * 'unknown' bucket.
 */
describe('startV2VTestSession — prompt attribution', () => {
  const buildMetadata = (
    existing: Record<string, unknown> | undefined,
    maxExchanges: number,
    selected: string | undefined,
  ) => ({
    ...(existing ?? {}),
    v2vTest: true,
    v2vMaxExchanges: maxExchanges,
    ...(selected ? { selectedMainPromptCode: selected } : {}),
  });

  it('records the scenario’s selected prompt alongside the v2v tags', () => {
    const md = buildMetadata(
      { sessionName: 'SS-1' },
      20,
      'ally_ai_learn_system_main_agent_prompt_working_memory_split',
    );

    expect(md).toMatchObject({
      sessionName: 'SS-1',
      v2vTest: true,
      v2vMaxExchanges: 20,
      selectedMainPromptCode:
        'ally_ai_learn_system_main_agent_prompt_working_memory_split',
    });
  });

  it('omits the key entirely when the scenario has no selected prompt', () => {
    // Absent, not null: analytics COALESCEs to a promptVersions fallback, and a
    // null would shadow it.
    const md = buildMetadata(undefined, 12, undefined);

    expect(md).not.toHaveProperty('selectedMainPromptCode');
    expect(md.v2vTest).toBe(true);
  });
});
