import { Test, TestingModule } from '@nestjs/testing';
import { SettingsShared } from '../settings.shared';
import { GlobalSettingsRepository } from '../../repository/global-settings.repository';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { AppVersionSettingsEnum } from '../../type/settings.type';

describe('SettingsShared', () => {
  let service: SettingsShared;
  let repository: GlobalSettingsRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsShared,
        {
          provide: GlobalSettingsRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SettingsShared>(SettingsShared);
    repository = module.get<GlobalSettingsRepository>(GlobalSettingsRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateGlobalSettings', () => {
    it('should use userId 0 when userId is not in the execution context', async () => {
      const dto = { ios: '1.0.0' };
      const existingSetting = {
        id: '1',
        name: AppVersionSettingsEnum.ios,
        value: { minimumSupportedVersion: '0.9.0' },
        createdBy: 1,
        updatedBy: 1,
      };

      (repository.find as jest.Mock).mockResolvedValue([existingSetting]);
      (repository.update as jest.Mock).mockResolvedValue(undefined);

      await ExecutionManager.runWithContext(async () => {
        await service.updateGlobalSettings(dto);
      });

      expect(repository.update).toHaveBeenCalledWith(existingSetting.id, {
        value: { minimumSupportedVersion: '1.0.0' },
        updatedBy: 0,
      });
    });
  });
});
