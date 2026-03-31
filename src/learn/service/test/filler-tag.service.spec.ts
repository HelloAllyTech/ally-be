import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FillerTagService } from '../filler-tag.service';
import { FillerTagRepository } from '../../repository/filler-tag.repository';

describe('FillerTagService', () => {
  let service: FillerTagService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    getFillerTags: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x: Record<string, unknown>) => ({
        ...x,
        id: 'uuid-1',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      })),
      getFillerTags: jest.fn(async () => ({
        data: [
          { id: 'a', name: 'um', createdAt: new Date(), updatedAt: new Date() },
        ],
        count: 1,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillerTagService,
        { provide: FillerTagRepository, useValue: repo },
      ],
    }).compile();

    service = module.get(FillerTagService);
  });

  it('createFillerTag saves and returns dto', async () => {
    const out = await service.createFillerTag({ name: 'well' }, 1);
    expect(out.id).toBe('uuid-1');
    expect(out.name).toBe('well');
    expect(repo.save).toHaveBeenCalled();
  });

  it('createFillerTag trims name', async () => {
    await service.createFillerTag({ name: '  um  ' }, 1);
    expect(repo.create).toHaveBeenCalledWith({
      name: 'um',
      createdBy: 1,
    });
  });

  it('createFillerTag rejects whitespace-only name', async () => {
    await expect(service.createFillerTag({ name: '   ' }, 1)).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('createFillerTag maps unique violation to ConflictException', async () => {
    const err: Error & { code?: string } = new Error('duplicate key') as any;
    err.name = 'QueryFailedError';
    err.code = '23505';
    repo.save.mockRejectedValueOnce(err);

    await expect(service.createFillerTag({ name: 'um' }, 1)).rejects.toThrow(
      ConflictException,
    );
  });

  it('getFillerTags maps rows', async () => {
    const out = await service.getFillerTags('u');
    expect(out.count).toBe(1);
    expect(out.data).toEqual([{ id: 'a', name: 'um' }]);
    expect(repo.getFillerTags).toHaveBeenCalledWith('u', undefined);
  });
});
