import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { Competency } from 'src/learn/entity/competency.entity';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { Track } from '../../entity/track.entity';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackSection } from '../../entity/track-section.entity';
import { TrackEnrollmentRepository } from '../../repository/track-enrollment.repository';
import { TrackRepository } from '../../repository/track.repository';
import { TrackStatus } from '../../type/track.type';
import { TrackService } from '../track.service';
import { TrackSharedService } from '../track-shared.service';
import { TrackTranslationService } from '../track-translation.service';

const EMPATHY = '00000000-0000-4000-8000-000000000001';
const HOPE = '00000000-0000-4000-8000-000000000002';
const PRIVATE_CUSTOM = '00000000-0000-4000-8000-000000000003';
const DELETED = '00000000-0000-4000-8000-000000000004';

/** The `competencies` rows that exist; `find({ where: { id: In(ids) } })` filters them. */
const COMPETENCY_ROWS = [
  { id: EMPATHY, isCustom: false },
  { id: HOPE, isCustom: false },
  { id: PRIVATE_CUSTOM, isCustom: true },
];

const competencyRepo = {
  find: jest.fn(async ({ where }: { where: { id: { value: string[] } } }) =>
    COMPETENCY_ROWS.filter((row) => where.id.value.includes(row.id)),
  ),
};

const trackRepository = {
  findOne: jest.fn(),
  save: jest.fn(async (track: Partial<Track>) => ({ ...track, id: 'new-id' })),
  update: jest.fn(),
};

const dataSource = {
  getRepository: jest.fn((entity: unknown) => {
    if (entity === Competency) return competencyRepo;
    throw new Error(`unexpected repository ${String(entity)}`);
  }),
  transaction: jest.fn(),
};

const trackSharedService = { getTrackWithStructure: jest.fn() };

describe('TrackService — course competency tag (tracks.competencyIds)', () => {
  let service: TrackService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackService,
        { provide: DataSource, useValue: dataSource },
        { provide: TrackRepository, useValue: trackRepository },
        {
          provide: TrackEnrollmentRepository,
          useValue: { existsForTrack: jest.fn().mockResolvedValue(false) },
        },
        { provide: TrackSharedService, useValue: trackSharedService },
        { provide: ScenarioSharedService, useValue: {} },
        { provide: CaseSharedService, useValue: {} },
        { provide: TenantService, useValue: { findAll: jest.fn() } },
        {
          provide: TrackTranslationService,
          useValue: { handleSourceChanged: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(TrackService);
  });

  describe('createTrack', () => {
    it('persists a deduped tag and returns it on the summary', async () => {
      const summary = await service.createTrack({
        title: 'Hope work',
        competencyIds: [HOPE, EMPATHY, HOPE],
      });

      expect(trackRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ competencyIds: [HOPE, EMPATHY] }),
      );
      expect(summary.competencyIds).toEqual([HOPE, EMPATHY]);
      // One lookup for the whole selection, not one per id.
      expect(competencyRepo.find).toHaveBeenCalledTimes(1);
    });

    it('stores NULL when no tag (or an empty one) is sent, without a lookup', async () => {
      await service.createTrack({ title: 'Untagged' });
      await service.createTrack({ title: 'Cleared', competencyIds: [] });

      expect(trackRepository.save.mock.calls[0][0].competencyIds).toBeNull();
      expect(trackRepository.save.mock.calls[1][0].competencyIds).toBeNull();
      expect(competencyRepo.find).not.toHaveBeenCalled();
    });

    it('rejects an id with no competency, and saves nothing', async () => {
      await expect(
        service.createTrack({ title: 'T', competencyIds: [EMPATHY, DELETED] }),
      ).rejects.toThrow(BadRequestException);
      expect(trackRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a custom competency', async () => {
      await expect(
        service.createTrack({ title: 'T', competencyIds: [PRIVATE_CUSTOM] }),
      ).rejects.toThrow(/existing, shared competencies/);
      expect(trackRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('updateTrack', () => {
    const stored = (competencyIds: string[] | null) =>
      ({
        id: 'track-1',
        title: 'Course',
        status: TrackStatus.DRAFT,
        competencyIds,
      }) as Track;

    it('leaves the tag untouched when the key is absent (status/title-only saves)', async () => {
      trackRepository.findOne.mockResolvedValue(stored([EMPATHY]));

      await service.updateTrack('track-1', { title: 'Renamed' });

      const payload = trackRepository.update.mock.calls[0][1];
      expect(payload).not.toHaveProperty('competencyIds');
      expect(competencyRepo.find).not.toHaveBeenCalled();
    });

    it('replaces the tag', async () => {
      trackRepository.findOne.mockResolvedValue(stored([EMPATHY]));

      await service.updateTrack('track-1', { competencyIds: [HOPE] });

      expect(trackRepository.update.mock.calls[0][1].competencyIds).toEqual([
        HOPE,
      ]);
    });

    it.each([
      ['null', null],
      ['[]', []],
    ])('clears the tag to NULL on %s', async (_label, competencyIds) => {
      trackRepository.findOne.mockResolvedValue(stored([EMPATHY]));

      await service.updateTrack('track-1', { competencyIds });

      expect(trackRepository.update.mock.calls[0][1].competencyIds).toBeNull();
    });

    it('drops an already-stored id whose competency was deleted instead of failing the save', async () => {
      trackRepository.findOne.mockResolvedValue(stored([EMPATHY, DELETED]));

      await service.updateTrack('track-1', {
        title: 'Unrelated edit',
        competencyIds: [EMPATHY, DELETED],
      });

      expect(trackRepository.update.mock.calls[0][1].competencyIds).toEqual([
        EMPATHY,
      ]);
    });

    it('still rejects a NEW unknown id on update', async () => {
      trackRepository.findOne.mockResolvedValue(stored([EMPATHY]));

      await expect(
        service.updateTrack('track-1', { competencyIds: [EMPATHY, DELETED] }),
      ).rejects.toThrow(BadRequestException);
      expect(trackRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('duplicateTrack', () => {
    it('carries the tag onto the copy', async () => {
      trackSharedService.getTrackWithStructure.mockResolvedValue({
        id: 'source',
        title: 'Original',
        status: TrackStatus.ACTIVE,
        isGlobal: false,
        totalItems: 0,
        competencyIds: [EMPATHY, HOPE],
        sections: [],
      });
      const savedTracks: Partial<Track>[] = [];
      dataSource.transaction.mockImplementation(
        async (work: (manager: unknown) => unknown) =>
          work({
            getRepository: (entity: unknown) => {
              if (entity === Track) {
                return {
                  save: jest.fn(async (track: Partial<Track>) => {
                    savedTracks.push(track);
                    return { ...track, id: 'copy' };
                  }),
                };
              }
              if (entity === TrackSection || entity === TrackItem) {
                return { save: jest.fn() };
              }
              throw new Error('unexpected repository');
            },
          }),
      );

      const summary = await service.duplicateTrack('source');

      expect(savedTracks[0].competencyIds).toEqual([EMPATHY, HOPE]);
      expect(savedTracks[0].status).toBe(TrackStatus.DRAFT);
      expect(summary.competencyIds).toEqual([EMPATHY, HOPE]);
    });

    it('copies an untagged course as untagged (NULL)', async () => {
      trackSharedService.getTrackWithStructure.mockResolvedValue({
        id: 'source',
        title: 'Original',
        isGlobal: false,
        totalItems: 0,
        competencyIds: null,
        sections: [],
      });
      const savedTracks: Partial<Track>[] = [];
      dataSource.transaction.mockImplementation(
        async (work: (manager: unknown) => unknown) =>
          work({
            getRepository: () => ({
              save: jest.fn(async (track: Partial<Track>) => {
                savedTracks.push(track);
                return { ...track, id: 'copy' };
              }),
            }),
          }),
      );

      await service.duplicateTrack('source');

      expect(savedTracks[0].competencyIds).toBeNull();
    });
  });
});
