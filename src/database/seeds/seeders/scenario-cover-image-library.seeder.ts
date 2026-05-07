import { DataSource } from 'typeorm';
import { ScenarioCoverImageLibrary } from '../../../scenario-cover-image-library/entity/scenario-cover-image-library.entity';
import { getRepo, log, upsert } from '../helpers';
import { scenarioCoverImages } from '../fixtures';

export async function seedScenarioCoverImageLibrary(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const repo = getRepo(ds, ScenarioCoverImageLibrary);

  for (const imageUrl of scenarioCoverImages) {
    await upsert(repo, { imageUrl }, { createdBy: adminUserId });
  }

  log(`scenario cover images: ${scenarioCoverImages.length}`);
}
