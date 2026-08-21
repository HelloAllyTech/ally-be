import * as fs from 'fs';

describe('migration timestamps', () => {
  it('does not stamp CreateAnalyticsChartPreferences and GlossaryGenerationPromptV3 with the same timestamp', () => {
    const migrationsDir = __dirname;
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));

    const analyticsChartPreferencesFile = files.find((file) =>
      file.includes('CreateAnalyticsChartPreferences'),
    );
    const glossaryGenerationPromptV3File = files.find((file) =>
      file.includes('GlossaryGenerationPromptV3'),
    );

    expect(analyticsChartPreferencesFile).toBeDefined();
    expect(glossaryGenerationPromptV3File).toBeDefined();

    const timestampOf = (file: string) => file.match(/^(\d+)-/)?.[1];

    expect(timestampOf(analyticsChartPreferencesFile as string)).not.toEqual(
      timestampOf(glossaryGenerationPromptV3File as string),
    );
  });
});
