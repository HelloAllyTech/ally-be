import { Test, TestingModule } from '@nestjs/testing';
import { LearnController } from '../learn.controller';
import { ScenarioService } from '../../service/scenario.service';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenarioStatus } from '../../type/scenario.type';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { ScenarioTenantService } from '../../service/scenario-tenant.service';
import { TriggerWarningsService } from '../../service/trigger-warnings.service';
import { SttConfigService } from '../../service/stt-config.service';
import { LlmConfigService } from '../../service/llm-config.service';
import { ScenarioVersionService } from '../../service/scenario-version.service';
import { PreviewMonologueService } from '../../service/preview-monologue.service';
import { ScenarioSharedService } from '../../service/scenario-shared.service';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';
import { ElevenLabsVoiceSyncService } from '../../service/elevenlabs-voice-sync.service';
import { TtsCatalogService } from '../../service/tts-catalog.service';
import { VideoActorCatalogService } from '../../service/video-actor-catalog.service';

describe('LearnController (Public)', () => {
  let controller: LearnController;
  let scenarioService: jest.Mocked<ScenarioService>;

  const publicScenario = {
    id: 1,
    title: 'Public Scenario',
    isPublic: true,
    status: ScenarioStatus.ACTIVE,
  } as Scenarios;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LearnController],
      providers: [
        {
          provide: ScenarioService,
          useValue: {
            getScenarios: jest.fn(),
          },
        },
        // Mock other dependencies as needed, using empty objects for simplicity
        { provide: ScenarioSessionService, useValue: {} },
        { provide: ScenarioTenantService, useValue: {} },
        { provide: TriggerWarningsService, useValue: {} },
        { provide: SttConfigService, useValue: {} },
        { provide: LlmConfigService, useValue: {} },
        { provide: ScenarioVersionService, useValue: {} },
        { provide: PreviewMonologueService, useValue: {} },
        { provide: ScenarioSharedService, useValue: {} },
        { provide: Reflector, useValue: {} },
        { provide: PermissionsService, useValue: {} },
        {
          provide: FeatureToggleService,
          useValue: { hasToggle: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: TenantFeatureService,
          useValue: { isEnabledForTenant: jest.fn().mockResolvedValue(false) },
        },
        { provide: UserService, useValue: {} },
        { provide: AppConfigService, useValue: {} },
        { provide: ElevenLabsVoiceSyncService, useValue: {} },
        { provide: TtsCatalogService, useValue: {} },
        { provide: VideoActorCatalogService, useValue: {} },
      ],
    }).compile();

    controller = module.get<LearnController>(LearnController);
    scenarioService = module.get(ScenarioService);
  });

  describe('getScenarios (Public Endpoint)', () => {
    it('should return only public scenarios', async () => {
      scenarioService.getScenarios.mockResolvedValue([publicScenario]);

      const result = await controller.getScenarios();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(publicScenario);
      expect(scenarioService.getScenarios).toHaveBeenCalledWith();
    });
  });
});
