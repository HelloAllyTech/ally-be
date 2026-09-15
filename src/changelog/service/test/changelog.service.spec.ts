import { Test, TestingModule } from '@nestjs/testing';

import { ChangelogSourceService } from '../changelog-source.service';
import { ChangelogService } from '../changelog.service';

const entries = Array.from({ length: 250 }, (_, index) => ({
  id: `id-${index}`,
  repo: 'ally-be',
  releaseNoteText: `Entry ${index}`,
  mergedAt: new Date(Date.UTC(2026, 8, 15, 0, 0, index)),
}));

describe('ChangelogService', () => {
  let service: ChangelogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangelogService,
        {
          provide: ChangelogSourceService,
          useValue: { getEntries: jest.fn().mockResolvedValue(entries) },
        },
      ],
    }).compile();
    service = module.get(ChangelogService);
  });

  it('returns the first page and the total count', async () => {
    const result = await service.findPublic({});

    expect(result.entries).toHaveLength(100);
    expect(result.entries[0].releaseNoteText).toBe('Entry 0');
    expect(result.count).toBe(250);
  });

  it('pages from an offset', async () => {
    const result = await service.findPublic({ offset: 100, limit: 100 });

    expect(result.entries[0].releaseNoteText).toBe('Entry 100');
    expect(result.entries).toHaveLength(100);
  });

  it('clamps an over-generous limit rather than rejecting it', async () => {
    const result = await service.findPublic({ limit: 5000 });

    expect(result.entries).toHaveLength(200);
  });

  it('treats a negative offset as the start', async () => {
    const result = await service.findPublic({ offset: -10, limit: 1 });

    expect(result.entries[0].releaseNoteText).toBe('Entry 0');
  });

  it('returns an empty page past the end, with the count intact', async () => {
    const result = await service.findPublic({ offset: 1000 });

    expect(result.entries).toEqual([]);
    expect(result.count).toBe(250);
  });

  it('exposes only the fields the public feed promises', async () => {
    const result = await service.findPublic({ limit: 1 });

    expect(Object.keys(result.entries[0]).sort()).toEqual([
      'id',
      'mergedAt',
      'releaseNoteText',
    ]);
  });
});
