import { Test, TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';
import { ScenarioSessionRecordingService } from '../scenario-session-recording.service';
import { ScenarioSessionRecordingRepository } from '../../repository/scenario-session-recording.repository';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { ScenarioSharedService } from '../scenario-shared.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { LiveKitService } from 'src/livekit/service/livekit.service';

describe('ScenarioSessionRecordingService', () => {
  let service: ScenarioSessionRecordingService;
  let recordingRepository: { findOne: jest.Mock; find: jest.Mock };
  let s3Service: { generatePresignedUrl: jest.Mock };
  const audioBucket = 'test-audio-bucket';

  beforeEach(async () => {
    recordingRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    s3Service = {
      generatePresignedUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionRecordingService,
        {
          provide: ScenarioSessionRecordingRepository,
          useValue: recordingRepository,
        },
        { provide: S3Service, useValue: s3Service },
        {
          provide: AppConfigService,
          useValue: {
            scenarioSessionAudioStorage: { bucket: audioBucket },
          },
        },
        { provide: ScenarioSharedService, useValue: {} },
        { provide: PermissionValidator, useValue: {} },
        { provide: LiveKitService, useValue: {} },
      ],
    }).compile();

    service = module.get<ScenarioSessionRecordingService>(
      ScenarioSessionRecordingService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRecordingUrlForSession', () => {
    it('returns null when no recording exists for the session', async () => {
      recordingRepository.findOne.mockResolvedValue(null);

      const result = await service.getRecordingUrlForSession('session-1');

      expect(result).toBeNull();
      expect(s3Service.generatePresignedUrl).not.toHaveBeenCalled();
    });

    it('returns a presigned URL when a recording exists', async () => {
      recordingRepository.findOne.mockResolvedValue({
        id: 'rec-1',
        scenarioSessionId: 'session-1',
        storageKey: 'recordings/session-1.mp4',
        egressId: 'egress-1',
      });
      s3Service.generatePresignedUrl.mockResolvedValue(
        'https://signed.example/audio',
      );

      const result = await service.getRecordingUrlForSession('session-1');

      expect(result).toEqual('https://signed.example/audio');
      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith({
        bucket: audioBucket,
        key: 'recordings/session-1.mp4',
        operation: 'get',
        expiresIn: 2400,
      });
    });
  });

  describe('getRecordingUrlsForSessions', () => {
    it('returns an empty map when given an empty session id list', async () => {
      const result = await service.getRecordingUrlsForSessions([]);

      expect(result.size).toBe(0);
      expect(recordingRepository.find).not.toHaveBeenCalled();
    });

    it('returns a map keyed by scenarioSessionId with one presigned URL per recording', async () => {
      recordingRepository.find.mockResolvedValue([
        {
          id: 'rec-1',
          scenarioSessionId: 'session-1',
          storageKey: 'recordings/session-1.mp4',
          egressId: 'egress-1',
        },
        {
          id: 'rec-2',
          scenarioSessionId: 'session-2',
          storageKey: 'recordings/session-2.mp4',
          egressId: 'egress-2',
        },
      ]);
      s3Service.generatePresignedUrl.mockImplementation(({ key }) =>
        Promise.resolve(`https://signed.example/${key}`),
      );

      const result = await service.getRecordingUrlsForSessions([
        'session-1',
        'session-2',
        'session-without-recording',
      ]);

      expect(recordingRepository.find).toHaveBeenCalledWith({
        where: {
          scenarioSessionId: In([
            'session-1',
            'session-2',
            'session-without-recording',
          ]),
        },
      });
      expect(result.get('session-1')).toEqual(
        'https://signed.example/recordings/session-1.mp4',
      );
      expect(result.get('session-2')).toEqual(
        'https://signed.example/recordings/session-2.mp4',
      );
      expect(result.has('session-without-recording')).toBe(false);
      expect(s3Service.generatePresignedUrl).toHaveBeenCalledTimes(2);
    });
  });
});
