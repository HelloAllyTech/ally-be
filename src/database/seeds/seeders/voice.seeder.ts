import { DataSource } from 'typeorm';
import { ScenarioVoices } from '../../../learn/entity/scenario-voices.entity';
import { getRepo, log, upsert } from '../helpers';
import { voices } from '../fixtures';

export async function seedVoices(ds: DataSource): Promise<void> {
  const repo = getRepo(ds, ScenarioVoices);
  for (const fixture of voices) {
    await upsert(
      repo,
      { name: fixture.name, languageId: fixture.languageId },
      {
        provider: fixture.provider,
        config: fixture.config,
        active: true,
      },
    );
  }
  log(`voices: ${voices.length}`);
}
