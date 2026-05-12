import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { S3Service } from 'src/aws/service/s3.service';
import { ScenarioSessionRecordingRepository } from '../repository/scenario-session-recording.repository';
import { AppConfigService } from 'src/config/config.service';
import { ScenarioSharedService } from './scenario-shared.service';
import { ScenarioSessionStatus } from '../enum/scenario-session-status.enum';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { LoggerService } from 'src/logger/logger.service';
import { EgressInfo } from 'livekit-server-sdk';
import { In } from 'typeorm';

@Injectable()
export class ScenarioSessionRecordingService {
  private readonly logger = LoggerService.getInstance(
    ScenarioSessionRecordingService.name,
  );
  constructor(
    private readonly scenarioSessionRecordingRepository: ScenarioSessionRecordingRepository,
    private readonly s3Service: S3Service,
    private readonly configService: AppConfigService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly permissionValidatorService: PermissionValidator,
    private readonly livekitService: LiveKitService,
  ) {}

  async getRecordingUrlForSession(
    scenarioSessionId: string,
  ): Promise<string | null> {
    const recording = await this.scenarioSessionRecordingRepository.findOne({
      where: { scenarioSessionId },
    });

    if (!recording) {
      return null;
    }

    return this.s3Service.generatePresignedUrl({
      bucket: this.configService.scenarioSessionAudioStorage.bucket!,
      key: recording.storageKey,
      operation: 'get',
      expiresIn: 2400,
    });
  }

  async getRecordingUrlsForSessions(
    scenarioSessionIds: string[],
  ): Promise<Map<string, string>> {
    if (scenarioSessionIds.length === 0) {
      return new Map();
    }

    const recordings = await this.scenarioSessionRecordingRepository.find({
      where: { scenarioSessionId: In(scenarioSessionIds) },
    });

    const bucket = this.configService.scenarioSessionAudioStorage.bucket!;
    const entries = await Promise.all(
      recordings.map(async (recording) => {
        const url = await this.s3Service.generatePresignedUrl({
          bucket,
          key: recording.storageKey,
          operation: 'get',
          expiresIn: 2400,
        });
        return [recording.scenarioSessionId, url] as const;
      }),
    );

    return new Map(entries);
  }

  async getScenarioSessionRecording(scenarioSessionId: string) {
    const scenarioSession =
      await this.scenarioSharedService.getScenarioSessionById(
        scenarioSessionId,
      );
    if (!scenarioSession) {
      throw new NotFoundException('Scenario session not found');
    }

    const userId = Number(ExecutionManager.getUserId());

    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new UnauthorizedException('Unauthorized access');
    }

    const hasAdminAccess =
      await this.permissionValidatorService.validatePermissions(userId, [
        PERMISSIONS.ORGANIZATION_ACCESS,
      ]);

    const isAllowed = hasAdminAccess
      ? scenarioSession.tenantId === tenantId
      : scenarioSession.counselorId === userId;

    if (!isAllowed) {
      throw new ForbiddenException('Forbidden access');
    }

    if (scenarioSession.status !== ScenarioSessionStatus.ENDED) {
      throw new NotFoundException('Scenario session is not completed');
    }

    const recording = await this.scenarioSessionRecordingRepository.findOne({
      where: { scenarioSessionId },
    });

    if (!recording) {
      throw new NotFoundException('Scenario session recording not found');
    }

    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket: this.configService.scenarioSessionAudioStorage.bucket!,
      key: recording.storageKey,
      operation: 'get',
      expiresIn: 2400, // 40 minutes
    });

    return { presignedUrl };
  }

  async stopScenarioSessionRecording(
    scenarioSessionId: string,
  ): Promise<EgressInfo | undefined> {
    const scenarioSessionRecording =
      await this.scenarioSessionRecordingRepository.findOne({
        where: {
          scenarioSessionId,
        },
      });
    this.logger.info(
      `Stopping scenario session recording for scenario session ${scenarioSessionId}: ${scenarioSessionRecording?.id}`,
    );

    if (!scenarioSessionRecording) {
      this.logger.info(
        `Scenario session recording not found for scenario session ${scenarioSessionId}`,
      );
      return;
    }

    if (scenarioSessionRecording) {
      try {
        return await this.livekitService.stopEgress(
          scenarioSessionRecording.egressId,
        );
      } catch (error) {
        this.logger.error(
          `Failed to stop scenario session recording for scenario session ${scenarioSessionId}: ${error.message}`,
        );
      }
    }
  }
}
