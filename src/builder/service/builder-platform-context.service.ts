import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderCatalogService } from './builder-catalog.service';
import { BuilderProductMapService } from './builder-product-map.service';

/**
 * The platform map as the Builder interview and research pass read it: the
 * reusable systems, the web/mobile twins, and the documentation index.
 *
 * A separate block of the interview's system prompt rather than more text in
 * the knowledge context, for two reasons. Its sources change on their own
 * schedule (catalogs weekly, docs with merges), so a block of its own keeps a
 * docs change from busting the cache on the packs and lessons beside it. And
 * the knowledge context is also read by build phases, which have no use for a
 * docs index.
 *
 * Fails soft, section by section: a missing piece reads as "look it up", never
 * as "nothing is there".
 */
@Injectable()
export class BuilderPlatformContextService {
  private readonly logger = LoggerService.getInstance(
    BuilderPlatformContextService.name,
  );

  constructor(
    private readonly catalog: BuilderCatalogService,
    private readonly productMap: BuilderProductMapService,
  ) {}

  async render(): Promise<string> {
    const [systems, docs] = await Promise.all([
      this.catalog.renderContextSection().catch((error: unknown) => {
        this.logger.warn(
          `Builder platform map: systems unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return '# Reusable platform systems\n\nCould not be read this time. Use capability_lookup.';
      }),
      this.productMap.renderDocsIndex().catch(() => ''),
    ]);
    return [systems, docs].filter((part) => part.trim()).join('\n\n');
  }
}
