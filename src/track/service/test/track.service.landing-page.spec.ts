import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { Track } from '../../entity/track.entity';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackSection } from '../../entity/track-section.entity';
import { TrackEnrollmentRepository } from '../../repository/track-enrollment.repository';
import { TrackRepository } from '../../repository/track.repository';
import { TrackItemType, TrackStatus } from '../../type/track.type';
import { StoryBeat } from '../../type/track-landing-page.type';
import { normaliseTrackLandingPage } from '../../util/track-landing-page.util';
import { TrackService } from '../track.service';
import { TrackSharedService } from '../track-shared.service';
import { TrackTranslationService } from '../track-translation.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

const trackRepository = {
  findOne: jest.fn(),
  save: jest.fn(async (track: Partial<Track>) => ({ ...track, id: 'new-id' })),
  update: jest.fn(),
};
const trackSharedService = { getTrackWithStructure: jest.fn() };

// Duplicate runs in a transaction; the manager hands each entity its own fake.
const copyTrackRepo = {
  save: jest.fn(async (track: Partial<Track>) => ({
    ...track,
    id: 'copy-track',
  })),
  update: jest.fn(),
};
let sectionCounter = 0;
const copySectionRepo = {
  save: jest.fn(async (section: Partial<TrackSection>) => ({
    ...section,
    id: `copy-section-${++sectionCounter}`,
  })),
};
const copyItemRepo = { save: jest.fn() };
const manager = {
  getRepository: jest.fn((entity: unknown) => {
    if (entity === Track) return copyTrackRepo;
    if (entity === TrackSection) return copySectionRepo;
    if (entity === TrackItem) return copyItemRepo;
    throw new Error(`unexpected repository ${String(entity)}`);
  }),
};
const dataSource = {
  transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
    work(manager),
  ),
};

const SECTION_A = '00000000-0000-4000-8000-0000000000a1';
const SECTION_B = '00000000-0000-4000-8000-0000000000b2';

// An unrestricted caller unless a test says otherwise.
const mockTenantScopeService = {
  isRestricted: jest.fn().mockResolvedValue(false),
};

describe('TrackService — story landing page (tracks.landingPage)', () => {
  let service: TrackService;

  beforeEach(async () => {
    jest.clearAllMocks();
    sectionCounter = 0;
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
          provide: TenantScopeService,
          useValue: mockTenantScopeService,
        },
        {
          provide: TrackTranslationService,
          useValue: { handleSourceChanged: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(TrackService);
  });

  describe('createTrack', () => {
    it('stores the full normalised shape', async () => {
      await service.createTrack({
        title: 'Course',
        landingPage: { hero: { hook: '  A call at 2am.  ' } },
      });

      const stored = trackRepository.save.mock.calls[0][0].landingPage;
      expect(stored).toEqual(
        normaliseTrackLandingPage({ hero: { hook: 'A call at 2am.' } }),
      );
      expect(stored?.firstMove.enabled).toBe(true);
    });

    it('stores NULL when none (or null) is sent', async () => {
      await service.createTrack({ title: 'Plain' });
      await service.createTrack({ title: 'Cleared', landingPage: null });

      expect(trackRepository.save.mock.calls[0][0].landingPage).toBeNull();
      expect(trackRepository.save.mock.calls[1][0].landingPage).toBeNull();
    });
  });

  describe('updateTrack', () => {
    const stored = {
      id: 'track-1',
      title: 'Course',
      status: TrackStatus.DRAFT,
      landingPage: normaliseTrackLandingPage({ hero: { hook: 'Existing' } }),
    } as Track;

    beforeEach(() => {
      trackRepository.findOne.mockResolvedValue(stored);
    });

    it('leaves the page alone when the key is absent (a publish toggle must not wipe a story)', async () => {
      await service.updateTrack('track-1', { title: 'Renamed' });

      expect(trackRepository.update.mock.calls[0][1]).not.toHaveProperty(
        'landingPage',
      );
    });

    it('clears the page on null', async () => {
      await service.updateTrack('track-1', { landingPage: null });

      expect(trackRepository.update.mock.calls[0][1].landingPage).toBeNull();
    });

    it('normalises and stores an object', async () => {
      await service.updateTrack('track-1', {
        landingPage: {
          hero: { hook: ' New hook ', question: '' },
          outcomes: { items: ['One', ' ', 'Two'] },
        },
      });

      const payload = trackRepository.update.mock.calls[0][1].landingPage;
      expect(payload.hero).toEqual({
        hook: 'New hook',
        question: null,
        courseLine: null,
        buttonLabel: null,
      });
      expect(payload.outcomes.items).toEqual(['One', 'Two']);
    });

    it('replaces rather than merges: a key left out of the object comes back as its default', async () => {
      await service.updateTrack('track-1', {
        landingPage: { persona: { name: 'Meera, 19' } },
      });

      const payload = trackRepository.update.mock.calls[0][1].landingPage;
      expect(payload.persona.name).toBe('Meera, 19');
      expect(payload.hero.hook).toBeNull();
    });
  });

  describe('duplicateTrack', () => {
    const source = (landingPage: unknown) => ({
      id: 'source',
      title: 'Original',
      description: null,
      coverImageUrl: null,
      isGlobal: false,
      totalItems: 2,
      estimatedDurationMinutes: 30,
      translations: null,
      competencyIds: null,
      landingPage,
      sections: [
        {
          id: SECTION_A,
          title: 'One',
          description: null,
          order: 0,
          translations: null,
          items: [
            {
              type: TrackItemType.ARTICLE,
              order: 0,
              title: 'Read',
              content: {},
            },
          ],
        },
        {
          id: SECTION_B,
          title: 'Two',
          description: null,
          order: 1,
          translations: null,
          items: [],
        },
      ],
    });

    it("re-points the chapters and hard call at the copy's new section ids", async () => {
      trackSharedService.getTrackWithStructure.mockResolvedValue(
        source(
          normaliseTrackLandingPage({
            hero: { hook: 'Hook' },
            arc: {
              chapters: [
                { sectionId: SECTION_A, beat: 'SETUP', teaser: 'a' },
                { sectionId: SECTION_B, beat: 'CLIMAX', teaser: 'b' },
              ],
              hardCallSectionId: SECTION_B,
            },
          }),
        ),
      );

      await service.duplicateTrack('source');

      // Sections are created in order, so A -> copy-section-1, B -> copy-section-2.
      expect(copyTrackRepo.update).toHaveBeenCalledTimes(1);
      const [copyId, patch] = copyTrackRepo.update.mock.calls[0];
      expect(copyId).toBe('copy-track');
      expect(patch.landingPage.hero.hook).toBe('Hook');
      expect(patch.landingPage.arc).toEqual({
        enabled: true,
        chapters: [
          { sectionId: 'copy-section-1', beat: StoryBeat.SETUP, teaser: 'a' },
          { sectionId: 'copy-section-2', beat: StoryBeat.CLIMAX, teaser: 'b' },
        ],
        hardCallSectionId: 'copy-section-2',
      });
      expect(JSON.stringify(patch)).not.toContain(SECTION_A);
      expect(JSON.stringify(patch)).not.toContain(SECTION_B);
    });

    it('runs the update inside the same transaction as the copy', async () => {
      trackSharedService.getTrackWithStructure.mockResolvedValue(
        source(normaliseTrackLandingPage({ hero: { hook: 'Hook' } })),
      );

      await service.duplicateTrack('source');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(trackRepository.update).not.toHaveBeenCalled();
      expect(copyTrackRepo.update).toHaveBeenCalledTimes(1);
    });

    it('does nothing about a landing page when the original has none', async () => {
      trackSharedService.getTrackWithStructure.mockResolvedValue(source(null));

      await service.duplicateTrack('source');

      expect(copyTrackRepo.update).not.toHaveBeenCalled();
    });
  });
});
