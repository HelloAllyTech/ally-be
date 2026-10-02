import { Test, TestingModule } from '@nestjs/testing';
import { TrackAdminController } from '../track-admin.controller';
import { TrackService } from '../../service/track.service';
import { TrackTenantService } from '../../service/track-tenant.service';
import { TrackMediaService } from '../../service/track-media.service';
import { TrackTranslationService } from '../../service/track-translation.service';
import { TrackProgressService } from '../../service/track-progress.service';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { OwnTenantScopeGuard } from 'src/auth/guards/own-tenant-scope.guard';

describe('TrackAdminController', () => {
  let controller: TrackAdminController;
  const mockTrackService = {
    getCriteriaHistory: jest.fn(),
  };
  const mockTrackProgressService = {
    getCompletedLearnerCount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrackAdminController],
      providers: [
        { provide: TrackService, useValue: mockTrackService },
        { provide: TrackTenantService, useValue: {} },
        { provide: TrackMediaService, useValue: {} },
        { provide: TrackTranslationService, useValue: {} },
        { provide: TrackProgressService, useValue: mockTrackProgressService },
      ],
    })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(OwnTenantScopeGuard)
    .useValue({ canActivate: () => true })
    .compile();

    controller = module.get<TrackAdminController>(TrackAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCompletedLearnerCount', () => {
    it('should call trackProgressService.getCompletedLearnerCount', async () => {
      const itemId = 'item-id';
      await controller.getCompletedLearnerCount(itemId);
      expect(mockTrackProgressService.getCompletedLearnerCount).toHaveBeenCalledWith(itemId);
    });
  });

  describe('getCriteriaHistory', () => {
    it('should call trackService.getCriteriaHistory', async () => {
      const itemId = 'item-id';
      await controller.getCriteriaHistory(itemId);
      expect(mockTrackService.getCriteriaHistory).toHaveBeenCalledWith(itemId);
    });
  });
});
