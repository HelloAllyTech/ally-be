import { DataSource } from 'typeorm';
import { ScenarioVoices } from '../../../learn/entity/scenario-voices.entity';
import { Languages } from '../../../language/entity/languages.entity';
import { getRepo, log, upsert } from '../helpers';
import { voiceByLanguageValue } from '../fixtures';

export async function seedVoices(ds: DataSource): Promise<void> {
  const voiceRepo = getRepo(ds, ScenarioVoices);
  const languageRepo = getRepo(ds, Languages);

  const languages = await languageRepo.find({ where: { active: true } });
  let created = 0;
  let skipped = 0;

  for (const lang of languages) {
    const fixture = voiceByLanguageValue[lang.value];
    if (!fixture) {
      skipped++;
      continue;
    }
    await upsert(
      voiceRepo,
      { name: fixture.name, languageId: lang.id },
      {
        provider: fixture.provider,
        config: fixture.config,
        active: true,
      },
    );
    created++;
  }

  log(
    `voices: ${created} (covered ${created}/${languages.length} languages` +
      (skipped ? `, ${skipped} without a fixture` : '') +
      ')',
  );
}
