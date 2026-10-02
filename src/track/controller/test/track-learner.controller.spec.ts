import { Test, TestingModule } from '@nestjs/testing';
import { TrackLearnerController } from '../track-learner.controller';
import { TrackProgressService } from '../../service/track-progress.service';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';

describe('TrackLearnerController', () => {
  let controller: TrackLearnerController;
  const mockTrackProgressService = {
    reevaluateProgress: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrackLearnerController],
      providers: [
        { provide: 'TrackEnrollmentService', useValue: {} },
        { provide: 'TrackQuizService', useValue: {} },
        { provide: 'TrackJournalService', useValue: {} },
        { provide: 'TrackAnnotationService', useValue: {} },
        { provide: 'TrackGameService', useValue: {} },
        { provide: 'TrackProgressDashboardService', useValue: {} },
        { provide: TrackProgressService, useValue: mockTrackProgressService },
      ],
    })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .compile();

    controller = module.get<TrackLearnerController>(TrackLearnerController);
  });


  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('reevaluateProgress', () => {
    it('should call trackProgressService.reevaluateProgress', async () => {
      const enrollmentId = 'enrollment-id';
      await controller.reevaluateProgress(enrollmentId);
      expect(mockTrackProgressService.reevaluateProgress).toHaveBeenCalledWith(enrollmentId);
    });
  });
});
