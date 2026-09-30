import { DataSource } from 'typeorm';

import {
  ProductUpdateSource,
  ProductUpdateSourceStatus,
} from '../../entity/product-update-source.entity';
import { ProductUpdate } from '../../entity/product-update.entity';
import { ProductUpdateSourceRepository } from '../../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../../repository/product-update.repository';
import { ProductUpdateConsolidationService } from '../product-update-consolidation.service';
import { ProductUpdatesAiService } from '../product-updates-ai.service';

const NOW = new Date('2026-09-30T12:00:00Z');

function source(overrides: Partial<ProductUpdateSource>): ProductUpdateSource {
  return {
    id: overrides.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
    journalId: 'j',
    updateId: null,
    status: ProductUpdateSourceStatus.ENRICHED,
    repo: 'ally-web',
    apps: [],
    mergedAt: new Date('2026-09-30T06:42:37Z'),
    journalLabel: 'public',
    prNumber: 733,
    prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/733',
    headRef: 'fix/helpline-character-interview',
    headSha: null,
    baseSha: null,
    author: 'sandeepmalhotra-ally',
    subjects: ['fix(helpline): recover character interviews'],
    body: 'What was broken',
    files: [
      'apps/ally-helpline-dashboard/src/pages/CharacterInterview/Page.tsx',
    ],
    filesTruncated: false,
    deployables: ['ally-web:helpline'],
    gatesLiveness: true,
    liveAt: null,
    enrichAttempts: 0,
    consolidateAttempts: 0,
    lastError: null,
    enrichedAt: NOW,
    consolidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ProductUpdateSource;
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  title: 'Creating a character by interview is more reliable',
  summary: 'The review form always opens when the interview finishes.',
  teamNotes: '- Helpline port.',
  kind: 'improved',
  audience: 'public',
  surfaces: ['web_app'],
  area: 'Characters',
  confidence: 0.9,
  ...overrides,
});

describe('ProductUpdateConsolidationService', () => {
  let service: ProductUpdateConsolidationService;
  let sourceRepository: { findByStatus: jest.Mock };
  let updateRepository: { findOpen: jest.Mock };
  let ai: { consolidate: jest.Mock };
  let sourceWrites: { update: jest.Mock };
  let updateWrites: { create: jest.Mock; save: jest.Mock; exists: jest.Mock };

  beforeEach(() => {
    sourceRepository = { findByStatus: jest.fn() };
    updateRepository = { findOpen: jest.fn().mockResolvedValue([]) };
    ai = { consolidate: jest.fn() };
    sourceWrites = { update: jest.fn().mockResolvedValue(undefined) };
    updateWrites = {
      create: jest.fn((values) => ({
        id: 'new-update',
        editedFields: [],
        ...values,
      })),
      save: jest.fn(async (update) => update),
      exists: jest.fn().mockResolvedValue(false),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === ProductUpdateSource ? sourceWrites : updateWrites,
    };
    const dataSource = {
      manager,
      transaction: jest.fn(async (work: (m: unknown) => Promise<void>) =>
        work(manager),
      ),
    } as unknown as DataSource;

    service = new ProductUpdateConsolidationService(
      dataSource,
      sourceRepository as unknown as ProductUpdateSourceRepository,
      updateRepository as unknown as ProductUpdateRepository,
      ai as unknown as ProductUpdatesAiService,
    );
  });

  it('reports done when nothing is waiting', async () => {
    sourceRepository.findByStatus.mockResolvedValue([]);

    const result = await service.consolidateBatch({ now: NOW, settleMs: 0 });

    expect(result.done).toBe(true);
    expect(ai.consolidate).not.toHaveBeenCalled();
  });

  it('files tests-only changes as noise without asking the model', async () => {
    const noise = source({
      files: ['src/x/test/x.spec.ts'],
      subjects: ['test: cover x'],
    });
    sourceRepository.findByStatus.mockResolvedValue([noise]);

    const result = await service.consolidateBatch({ now: NOW, settleMs: 0 });

    expect(result.noise).toBe(1);
    expect(ai.consolidate).not.toHaveBeenCalled();
    expect(sourceWrites.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: ProductUpdateSourceStatus.NOISE }),
    );
  });

  it('creates an update from a new decision and attaches its merges', async () => {
    const merge = source({ id: 's1' });
    sourceRepository.findByStatus.mockResolvedValue([merge]);
    ai.consolidate.mockResolvedValue({
      model: 'gpt-5-mini',
      parsed: {
        decisions: [
          {
            action: 'new',
            clusterIds: ['c1'],
            update: draft(),
            reason: 'Visible fix.',
          },
        ],
        unresolvedClusterIds: [],
        problems: [],
      },
    });

    const result = await service.consolidateBatch({ now: NOW, settleMs: 0 });

    expect(result.created).toBe(1);
    expect(updateWrites.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: '2026-09-30-creating-a-character-by-interview-is-more-reliable',
        audience: 'public',
        model: 'gpt-5-mini',
        liveAt: null,
      }),
    );
    expect(sourceWrites.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: ProductUpdateSourceStatus.CONSOLIDATED,
        updateId: 'new-update',
      }),
    );
  });

  it('keeps a staff-only change internal even when the model says public', async () => {
    const staff = source({
      id: 's1',
      repo: 'ally-be',
      subjects: ['feat(analytics): XP per roleplay minute endpoint (AAQ-165)'],
      files: ['src/analytics/service/xp.service.ts'],
    });
    sourceRepository.findByStatus.mockResolvedValue([staff]);
    ai.consolidate.mockResolvedValue({
      model: 'm',
      parsed: {
        decisions: [
          { action: 'new', clusterIds: ['c1'], update: draft(), reason: '' },
        ],
        unresolvedClusterIds: [],
        problems: [],
      },
    });

    await service.consolidateBatch({ now: NOW, settleMs: 0 });

    expect(updateWrites.create).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'internal' }),
    );
  });

  it('never rewrites a field a person edited, nor the audience of a published update', async () => {
    const open = {
      id: 'u1',
      title: 'Edited title',
      summary: 'Old summary',
      teamNotes: '',
      kind: 'new',
      audience: 'public',
      surfaces: ['web_app'],
      area: 'Roleplays',
      confidence: 0.9,
      editedFields: ['title'],
      firstMergedAt: new Date('2026-09-29T00:00:00Z'),
      lastMergedAt: new Date('2026-09-29T00:00:00Z'),
      liveAt: new Date('2026-09-29T08:00:00Z'),
      publishedAt: new Date('2026-09-29T08:00:00Z'),
      sources: [],
    } as unknown as ProductUpdate;
    updateRepository.findOpen.mockResolvedValue([open]);
    sourceRepository.findByStatus.mockResolvedValue([source({ id: 's2' })]);
    ai.consolidate.mockResolvedValue({
      model: 'm',
      parsed: {
        decisions: [
          {
            action: 'attach',
            clusterIds: ['c1'],
            updateId: 'u1',
            update: {
              title: 'Model title',
              summary: 'New summary',
              audience: 'internal',
              kind: 'fixed',
            },
            reason: 'Follow-up.',
          },
        ],
        unresolvedClusterIds: [],
        problems: [],
      },
    });

    const result = await service.consolidateBatch({ now: NOW, settleMs: 0 });

    expect(result.attached).toBe(1);
    const saved = updateWrites.save.mock.calls[0][0];
    expect(saved.title).toBe('Edited title');
    expect(saved.summary).toBe('New summary');
    expect(saved.audience).toBe('public');
    expect(saved.kind).toBe('new');
    // Already public: it stays up while the follow-up waits for its release.
    expect(saved.liveAt).toEqual(new Date('2026-09-29T08:00:00Z'));
  });

  it('counts an attempt when the model fails, and files the change as internal after the last one', async () => {
    sourceRepository.findByStatus.mockResolvedValueOnce([
      source({ id: 's1', consolidateAttempts: 0 }),
    ]);
    ai.consolidate.mockRejectedValueOnce(new Error('timeout'));

    const first = await service.consolidateBatch({ now: NOW, settleMs: 0 });

    expect(first.error).toBe('timeout');
    expect(first.unresolved).toBe(1);
    expect(sourceWrites.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ consolidateAttempts: 1 }),
    );

    sourceRepository.findByStatus.mockResolvedValueOnce([
      source({ id: 's1', consolidateAttempts: 3 }),
    ]);
    ai.consolidate.mockRejectedValueOnce(new Error('timeout'));

    const last = await service.consolidateBatch({ now: NOW, settleMs: 0 });

    expect(last.forced).toBe(1);
    expect(updateWrites.create).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'internal', confidence: 0 }),
    );
  });
});
