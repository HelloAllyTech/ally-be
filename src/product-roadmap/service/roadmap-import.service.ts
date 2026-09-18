import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';

import {
  RoadmapImportOptions,
  RoadmapImportResult,
  RoadmapSnapshot,
  runRoadmapImport,
} from '../import/roadmap-import.core';

/**
 * Largest bundle we will accept, well above the real one (~700 KB) but small enough that a
 * mistaken upload cannot exhaust memory parsing it.
 */
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

/** Arrays the bundle must contain. `release_notes`/`saved_views`/`user_tab_order` are optional. */
const REQUIRED_ARRAYS = [
  'app_users',
  'product_goals',
  'opportunity_owners',
  'opportunities',
  'allocations',
  'opportunity_comments',
  'interview_notes',
] as const;

/**
 * The API-side entry point for the Supabase → Ally import.
 *
 * Exists so the migration can be run WITHOUT a host that can reach production Postgres. The CLI
 * needs a bastion, a tunnel or a one-off task; this runs inside deployed ally-be, which already has
 * database access — and it means a snapshot containing user-interview transcripts never has to move
 * between laptops.
 *
 * All the actual work is in `import/roadmap-import.core.ts`, shared with the CLI, so the two cannot
 * drift. This class only parses and validates the upload.
 */
@Injectable()
export class RoadmapImportService {
  private readonly logger = LoggerService.getInstance(
    RoadmapImportService.name,
  );

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Parse an uploaded bundle and run the import.
   *
   * The bundle is the export script's folder as a single JSON object, keyed by the snapshot FILE
   * names — `{ "manifest": {...}, "opportunities": [...], ... }`. Multipart rather than a JSON body
   * because ally-be caps JSON at 1 MB and a real snapshot is ~700 KB: it would fit today and break
   * the first time somebody files a few hundred more opportunities.
   */
  async importFromBundle(
    actorId: number,
    file: Express.Multer.File | undefined,
    options: RoadmapImportOptions,
  ): Promise<RoadmapImportResult> {
    const snapshot = this.parseBundle(file);

    this.logger.info(
      `[ROADMAP] Import requested by user ${actorId}: dryRun=${options.dryRun !== false} ` +
        `createUsers=${options.createMissingUsers === true} ` +
        `opportunities=${snapshot.opportunities.length} ` +
        `votes=${snapshot.manifest?.totalVotes}`,
    );

    const result = await runRoadmapImport(this.dataSource, snapshot, options);

    // Logged at info even for a dry run: this endpoint can rewrite the entire board, so every
    // invocation should be attributable after the fact, not just the ones that committed.
    this.logger.info(
      `[ROADMAP] Import by user ${actorId} finished: committed=${result.committed} ` +
        `dryRun=${result.dryRun} failedChecks=${result.failedChecks.length}`,
    );

    return result;
  }

  /**
   * Turn the upload into a snapshot, rejecting anything malformed BEFORE opening a transaction.
   *
   * Deliberately strict. This endpoint writes 500+ rows and can create user accounts, so a
   * confusing 500 from deep inside the loader is a much worse outcome than a clear 400 here.
   */
  private parseBundle(file: Express.Multer.File | undefined): RoadmapSnapshot {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'No bundle uploaded. Send the snapshot as multipart form-data under the field "file".',
      );
    }
    if (file.size > MAX_BUNDLE_BYTES) {
      throw new BadRequestException(
        `Bundle is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_BUNDLE_BYTES / 1024 / 1024} MB.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException(
        'Bundle is not valid JSON. Build it with scripts/bundle-snapshot.mjs.',
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException(
        'Bundle must be a JSON object keyed by snapshot file name.',
      );
    }
    const bundle = parsed as Record<string, unknown>;

    // The manifest is what every verification check compares against. Without it the load is
    // unverifiable, which is worse than not running at all.
    const manifest = bundle.manifest as RoadmapSnapshot['manifest'] | undefined;
    if (!manifest || typeof manifest !== 'object') {
      throw new BadRequestException(
        'Bundle is missing "manifest" — refusing to load a snapshot that cannot be verified.',
      );
    }
    if (typeof manifest.totalVotes !== 'number') {
      throw new BadRequestException(
        'Bundle manifest has no numeric totalVotes, so vote conservation could not be checked.',
      );
    }

    const missing = REQUIRED_ARRAYS.filter(
      (key) => !Array.isArray(bundle[key]),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Bundle is missing or has non-array values for: ${missing.join(', ')}.`,
      );
    }

    return bundle as unknown as RoadmapSnapshot;
  }
}
