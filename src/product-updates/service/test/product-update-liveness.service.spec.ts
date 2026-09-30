import { GithubActionsService } from 'src/github/service/github-actions.service';

import { ProductUpdateSourceStatus } from '../../entity/product-update-source.entity';
import { ProductUpdateSourceRepository } from '../../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../../repository/product-update.repository';
import { ProductUpdateLivenessService } from '../product-update-liveness.service';

const at = (iso: string) => new Date(iso);

describe('ProductUpdateLivenessService', () => {
  let github: { isConfigured: boolean; listSuccessfulRuns: jest.Mock };
  let sourceRepository: { find: jest.Mock; save: jest.Mock };
  let updateRepository: { findNotLive: jest.Mock; save: jest.Mock };
  let service: ProductUpdateLivenessService;

  const backend = {
    id: 's-be',
    updateId: 'u1',
    status: ProductUpdateSourceStatus.CONSOLIDATED,
    repo: 'ally-be',
    mergedAt: at('2026-09-30T08:42:38Z'),
    deployables: ['ally-be'],
    gatesLiveness: true,
    liveAt: null as Date | null,
  };
  const admin = {
    id: 's-web',
    updateId: 'u1',
    status: ProductUpdateSourceStatus.CONSOLIDATED,
    repo: 'ally-web',
    mergedAt: at('2026-09-30T08:42:51Z'),
    deployables: ['ally-web:admin'],
    gatesLiveness: true,
    liveAt: null as Date | null,
  };

  beforeEach(() => {
    backend.liveAt = null;
    admin.liveAt = null;
    github = { isConfigured: true, listSuccessfulRuns: jest.fn() };
    sourceRepository = {
      find: jest.fn().mockResolvedValue([backend, admin]),
      save: jest.fn(async (rows) => rows),
    };
    updateRepository = {
      findNotLive: jest.fn(),
      save: jest.fn(async (row) => row),
    };
    service = new ProductUpdateLivenessService(
      github as unknown as GithubActionsService,
      sourceRepository as unknown as ProductUpdateSourceRepository,
      updateRepository as unknown as ProductUpdateRepository,
    );
  });

  it('marks each change live at the first release after it merged, and waits on the rest', async () => {
    github.listSuccessfulRuns.mockImplementation(async ({ repo }) =>
      repo === 'ally-be'
        ? [
            {
              id: '1',
              htmlUrl: '',
              startedAt: at('2026-09-30T09:52:35Z'),
              finishedAt: at('2026-09-30T10:10:00Z'),
            },
          ]
        : [
            {
              id: '2',
              htmlUrl: '',
              startedAt: at('2026-09-29T09:40:03Z'),
              finishedAt: at('2026-09-29T09:50:00Z'),
            },
          ],
    );
    const update = {
      id: 'u1',
      audience: 'public',
      hidden: false,
      liveAt: null,
      publishedAt: null,
      sources: [backend, admin],
    };
    updateRepository.findNotLive.mockResolvedValue([update]);

    const result = await service.refresh(at('2026-09-30T12:00:00Z'));

    expect(backend.liveAt).toEqual(at('2026-09-30T10:10:00Z'));
    expect(admin.liveAt).toBeNull();
    expect(result.sourcesLive).toBe(1);
    // The admin half has not shipped, so neither has the update.
    expect(update.liveAt).toBeNull();
    expect(result.published).toBe(0);
  });

  it('publishes a public update at its live date once every change has shipped', async () => {
    github.listSuccessfulRuns.mockResolvedValue([
      {
        id: '1',
        htmlUrl: '',
        startedAt: at('2026-09-30T09:52:35Z'),
        finishedAt: at('2026-09-30T10:10:00Z'),
      },
    ]);
    const update = {
      id: 'u1',
      audience: 'public',
      hidden: false,
      liveAt: null as Date | null,
      publishedAt: null as Date | null,
      sources: [backend, admin],
    };
    updateRepository.findNotLive.mockResolvedValue([update]);

    const result = await service.refresh(at('2026-09-30T12:00:00Z'));

    expect(update.liveAt).toEqual(at('2026-09-30T10:10:00Z'));
    expect(update.publishedAt).toEqual(update.liveAt);
    expect(result.published).toBe(1);
  });

  it('never publishes an internal or hidden update, but still marks it live', async () => {
    github.listSuccessfulRuns.mockResolvedValue([
      {
        id: '1',
        htmlUrl: '',
        startedAt: at('2026-09-30T09:52:35Z'),
        finishedAt: at('2026-09-30T10:10:00Z'),
      },
    ]);
    const internal = {
      id: 'u1',
      audience: 'internal',
      hidden: false,
      liveAt: null,
      publishedAt: null,
      sources: [backend, admin],
    };
    updateRepository.findNotLive.mockResolvedValue([internal]);

    await service.refresh(at('2026-09-30T12:00:00Z'));

    expect(internal.liveAt).not.toBeNull();
    expect(internal.publishedAt).toBeNull();
  });

  it('leaves changes waiting when a release history cannot be read, rather than guessing', async () => {
    github.listSuccessfulRuns.mockResolvedValue(null);
    updateRepository.findNotLive.mockResolvedValue([]);

    const result = await service.refresh(at('2026-09-30T12:00:00Z'));

    expect(result.unreadable.sort()).toEqual(['ally-be', 'ally-web:admin']);
    expect(backend.liveAt).toBeNull();
    expect(sourceRepository.save).not.toHaveBeenCalled();
  });

  it('lets a docs-only change ride along without waiting for a release', async () => {
    const docs = { ...backend, id: 's-docs', gatesLiveness: false };
    sourceRepository.find.mockResolvedValue([docs]);
    github.listSuccessfulRuns.mockResolvedValue([]);
    updateRepository.findNotLive.mockResolvedValue([]);

    await service.refresh(at('2026-09-30T12:00:00Z'));

    expect(docs.liveAt).toEqual(docs.mergedAt);
  });
});
