#!/usr/bin/env ts-node
/**
 * Bulk generate linguistic style samples for scenarios.
 *
 * For each scenario, generates 10 sample utterances per language in languageVoices
 * (including English India, English Global, and other languages), using the
 * scenario's character context.
 *
 * Usage:
 *   npm run generate:linguistic-samples -- <scenarioId1> [scenarioId2] ...
 *   ts-node -r tsconfig-paths/register src/database/scripts/generate-linguistic-style-samples.ts 123 456
 *
 * Requires: OPENAI_API_KEY (or config) for generation.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { ScenarioService } from '../../learn/service/scenario.service';
import { GeneratableField } from '../../learn/enum/generatable-field.enum';
import { SharedLanguageService } from '../../language/service/shared-language.service';

async function main() {
  const scenarioIds = process.argv.slice(2).map((id) => parseInt(id, 10));
  if (scenarioIds.length === 0) {
    console.error(
      'Usage: npm run generate:linguistic-samples -- <scenarioId1> [scenarioId2] ...',
    );
    process.exit(1);
  }

  const invalidIds = scenarioIds.filter((id) => isNaN(id));
  if (invalidIds.length > 0) {
    console.error('Invalid scenario IDs:', invalidIds);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const scenarioService = app.get(ScenarioService);
  const languageService = app.get(SharedLanguageService);

  for (const scenarioId of scenarioIds) {
    console.log(`\nProcessing scenario ${scenarioId}...`);

    try {
      const scenario = await scenarioService.getAdminScenario(scenarioId);
      if (!scenario) {
        console.warn(`  Scenario ${scenarioId} not found, skipping.`);
        continue;
      }

      const languageVoices = (scenario.metadata as any)?.languageVoices ?? {};
      const languageIds = Object.keys(languageVoices).filter(
        (id) => languageVoices[id],
      );

      if (languageIds.length === 0) {
        console.warn(
          `  No language-voice mappings for scenario ${scenarioId}, skipping.`,
        );
        continue;
      }

      const languageDetails = await languageService.getLanguagesByIds(
        languageIds.map((id) => parseInt(id, 10)),
      );
      const languageMap = new Map(languageDetails?.map((l) => [l.id, l]) ?? []);

      const linguisticStyleSamples: Record<string, string[]> =
        (scenario.metadata as any)?.linguisticStyleSamples ?? {};

      let generated = 0;
      for (const langIdStr of languageIds) {
        const langId = parseInt(langIdStr, 10);
        const lang = languageMap.get(langId);
        if (!lang) continue;

        const scenarioContext = {
          title: scenario.title ?? 'Scenario',
          name: scenario.metadata?.name ?? 'Client',
          age: scenario.metadata?.age,
          gender: scenario.metadata?.gender,
          currentLocation: scenario.metadata?.currentLocation ?? '',
          characterProfileText: scenario.metadata?.characterProfileText ?? '',
          challengeDescription: scenario.description ?? '',
          languageId: langIdStr,
          languageCode: lang.value ?? '',
          languageName: lang.label ?? '',
        };

        const result = await scenarioService.generateField({
          fieldName: GeneratableField.LINGUISTIC_STYLE_SAMPLES,
          scenarioContext,
        });

        const content = result?.content;
        if (Array.isArray(content) && content.length > 0) {
          linguisticStyleSamples[langIdStr] = content as string[];
          generated++;
          console.log(
            `  Generated ${content.length} samples for ${lang.label}`,
          );
        } else {
          console.warn(`  No samples generated for ${lang.label}`);
        }
      }

      if (generated > 0) {
        await scenarioService.updateScenario(
          scenarioId,
          { linguisticStyleSamples },
          0,
        );
        console.log(
          `  Updated scenario ${scenarioId} with linguistic style samples.`,
        );
      }
    } catch (err) {
      console.error(`  Error processing scenario ${scenarioId}:`, err);
    }
  }

  await app.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
