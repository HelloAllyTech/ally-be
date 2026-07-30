import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RoadmapImportService } from '../roadmap-import.service';

/** A bundle that passes validation, so each test can break exactly one thing. */
const validBundle = () => ({
  manifest: {
    projectRef: 'test',
    extractedAt: '2026-07-30T00:00:00.000Z',
    tables: {
      product_goals: 0,
      opportunity_owners: 0,
      opportunities: 0,
      allocations: 0,
      opportunity_comments: 0,
      interview_notes: 0,
      release_notes: 0,
      saved_views: 0,
      user_tab_order: 0,
    },
    totalCoins: 0,
    allocationRows: 0,
    coinsByUserPeriod: {},
    priorityScores: {},
  },
  app_users: [],
  product_goals: [],
  opportunity_owners: [],
  opportunities: [],
  allocations: [],
  opportunity_comments: [],
  interview_notes: [],
  release_notes: [],
  saved_views: [],
  user_tab_order: [],
});

const asUpload = (body: unknown): Express.Multer.File => {
  const buffer = Buffer.from(
    typeof body === 'string' ? body : JSON.stringify(body),
    'utf8',
  );
  return { buffer, size: buffer.length } as Express.Multer.File;
};

/**
 * Covers the UPLOAD VALIDATION, which is this class's actual job. The endpoint can rewrite the
 * whole board and create user accounts, so a malformed bundle must be a clear 400 raised BEFORE a
 * transaction opens — never a 500 from deep inside the loader.
 *
 * THE COMMIT / DRY-RUN BRANCHES ARE DELIBERATELY NOT UNIT-TESTED HERE. Two checks (V2b per
 * (user,period) sums, V4 priority scores) iterate result SETS rather than reading a scalar, so a
 * mocked query runner would have to reimplement enough Postgres to satisfy them — and a test built
 * that way asserts against the mock, not the code. Worse, with a mock that makes any check fail, a
 * "dry run does not commit" assertion passes whether or not dry-run works, because a failed check
 * rolls back anyway. A test that green-lights for the wrong reason is worse than no test.
 *
 * Those branches were instead verified for real against the 505-opportunity production snapshot on
 * a local database:
 *   - dry run (no flags)      → committed=false, 16 checks, database still empty
 *   - dryRun=false            → committed=true, 505 opportunities / 1080 coins written
 *   - tampered manifest       → V2 TOTAL COINS failed, rolled back, database back to 0 rows
 *   - identical second commit → no-op, still 505 / 1080
 */
describe('RoadmapImportService', () => {
  let service: RoadmapImportService;
  let queryRunner: Record<string, jest.Mock> & { isTransactionActive: boolean };

  beforeEach(async () => {
    // Every mock RESOLVES: the core calls `.catch()` on rollbackTransaction, so a bare
    // jest.fn() returning undefined would throw and mask the error under test.
    // '0' answers every COUNT/SUM, which is what makes the empty-snapshot fixture verify clean.
    const answerZero = jest.fn().mockResolvedValue([{ value: '0' }]);
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: answerZero,
      isTransactionActive: true,
      manager: { query: answerZero } as never,
    } as never;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapImportService,
        {
          provide: DataSource,
          useValue: { createQueryRunner: () => queryRunner },
        },
      ],
    }).compile();

    service = module.get(RoadmapImportService);
  });

  const importIt = (body: unknown, options = {}) =>
    service.importFromBundle(1, asUpload(body), options);

  it('rejects a missing upload without opening a transaction', async () => {
    await expect(service.importFromBundle(1, undefined, {})).rejects.toThrow(
      BadRequestException,
    );
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('rejects an empty upload', async () => {
    const empty = { buffer: Buffer.alloc(0), size: 0 } as Express.Multer.File;
    await expect(service.importFromBundle(1, empty, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a bundle that is not valid JSON', async () => {
    await expect(importIt('this is not json')).rejects.toThrow(
      BadRequestException,
    );
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('rejects a JSON array — the bundle must be an object keyed by file name', async () => {
    await expect(importIt([1, 2, 3])).rejects.toThrow(BadRequestException);
  });

  it('REFUSES a bundle with no manifest', async () => {
    // Every verification check compares against the manifest. Without it the load is
    // unverifiable, which is worse than not running at all.
    const bundle = validBundle();
    delete (bundle as Record<string, unknown>).manifest;
    await expect(importIt(bundle)).rejects.toThrow(/manifest/i);
  });

  it('REFUSES a manifest with no numeric totalCoins', async () => {
    // V2 TOTAL COINS is the headline assertion; a non-numeric expectation would silently
    // never fail.
    const bundle = validBundle();
    (bundle.manifest as Record<string, unknown>).totalCoins = 'lots';
    await expect(importIt(bundle)).rejects.toThrow(/totalCoins/);
  });

  it('names every missing required table in one message', async () => {
    const bundle = validBundle();
    delete (bundle as Record<string, unknown>).opportunities;
    delete (bundle as Record<string, unknown>).allocations;
    await expect(importIt(bundle)).rejects.toThrow(
      /opportunities.*allocations|allocations.*opportunities/,
    );
  });

  it('rejects a required table that is present but not an array', async () => {
    const bundle = validBundle();
    (bundle as Record<string, unknown>).opportunities = { not: 'an array' };
    await expect(importIt(bundle)).rejects.toThrow(/opportunities/);
  });

  it('tolerates the optional tables being absent', async () => {
    // release_notes / saved_views / user_tab_order are legitimately empty in real snapshots —
    // the source shipped release notes and nobody ever used them.
    const bundle = validBundle();
    delete (bundle as Record<string, unknown>).release_notes;
    delete (bundle as Record<string, unknown>).saved_views;
    delete (bundle as Record<string, unknown>).user_tab_order;

    await importIt(bundle);
    expect(queryRunner.startTransaction).toHaveBeenCalled();
  });

  it('releases the query runner even when the load throws', async () => {
    queryRunner.query.mockRejectedValue(new Error('database is on fire'));
    (
      queryRunner.manager as unknown as { query: jest.Mock }
    ).query.mockRejectedValue(new Error('database is on fire'));
    await expect(importIt(validBundle(), { dryRun: false })).rejects.toThrow(
      'database is on fire',
    );
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('does not attempt a second rollback when the transaction already ended', async () => {
    // A doubled rollback would throw and mask the original error, which is the one worth seeing.
    queryRunner.query.mockRejectedValue(new Error('original failure'));
    (
      queryRunner.manager as unknown as { query: jest.Mock }
    ).query.mockRejectedValue(new Error('original failure'));
    queryRunner.isTransactionActive = false;

    await expect(importIt(validBundle(), { dryRun: false })).rejects.toThrow(
      'original failure',
    );
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });
});
