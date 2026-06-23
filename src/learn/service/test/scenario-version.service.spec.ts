import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioVersionService } from '../scenario-version.service';
import { ScenarioVersionRepository } from '../../repository/scenario-version.repository';
import { ScenariosRepository } from '../../repository/scenario.repository';
import { ScenarioService } from '../scenario.service';
import { ScenarioVersion } from '../../entity/scenario-version.entity';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenarioVersionStatus } from '../../enum/scenario-version-status.enum';
import { ScenarioStatus } from '../../type/scenario.type';
import { PermissionsService } from 'src/authorization/service/permissions.service';

describe('ScenarioVersionService', () => {
  let service: ScenarioVersionService;
  let versionRepo: jest.Mocked<Partial<ScenarioVersionRepository>>;
  let scenariosRepo: jest.Mocked<Partial<ScenariosRepository>>;
  let scenarioService: jest.Mocked<Partial<ScenarioService>>;
  let permissionsService: jest.Mocked<Partial<PermissionsService>>;
  // Captured repositories handed to the transaction callback.
  let txVersionRepo: any;
  let txScenarioRepo: any;
  let dataSource: Partial<DataSource>;

  const scenario: Scenarios = {
    id: 10,
    status: ScenarioStatus.ACTIVE,
    createdBy: 1,
    publishedVersionId: 'v-published',
  } as Scenarios;

  beforeEach(async () => {
    txVersionRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'v-new', ...x })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneOrFail: jest.fn((opts) =>
        Promise.resolve({ id: opts.where.id, status: 'PUBLISHED' }),
      ),
    };
    txScenarioRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    versionRepo = {
      listByScenario: jest.fn(),
      findOne: jest.fn(),
      getNextVersionNumber: jest.fn().mockResolvedValue(3),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    scenariosRepo = { findOne: jest.fn().mockResolvedValue(scenario) };
    scenarioService = {
      updateScenario: jest.fn().mockResolvedValue(true),
      getAdminScenario: jest.fn(),
      getScenarioEvents: jest.fn().mockResolvedValue({ data: [], count: 0 }),
      mapEventsToScenario: jest.fn().mockResolvedValue(undefined),
      deleteScenarioEvents: jest.fn().mockResolvedValue(undefined),
    };
    permissionsService = {
      isMultiTenantAdmin: jest.fn().mockResolvedValue(false),
    };
    dataSource = {
      transaction: jest.fn((cb: any) =>
        cb({
          getRepository: (entity: any) =>
            entity === ScenarioVersion ? txVersionRepo : txScenarioRepo,
        }),
      ) as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioVersionService,
        { provide: ScenarioVersionRepository, useValue: versionRepo },
        { provide: ScenariosRepository, useValue: scenariosRepo },
        { provide: ScenarioService, useValue: scenarioService },
        { provide: PermissionsService, useValue: permissionsService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ScenarioVersionService);
  });

  describe('createVersion', () => {
    it('branches from an explicit version, cloning its config as a DRAFT', async () => {
      (versionRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'v-parent',
        scenarioId: 10,
        config: { title: 'parent', status: ScenarioStatus.ACTIVE },
      });

      await service.createVersion(10, { fromVersionId: 'v-parent' }, 1);

      const created = txVersionRepo.create.mock.calls[0][0];
      expect(created.parentVersionId).toBe('v-parent');
      expect(created.versionNumber).toBe(3);
      expect(created.status).toBe(ScenarioVersionStatus.DRAFT);
      // Cloned config keeps fields but is forced back to DRAFT.
      expect(created.config).toMatchObject({
        title: 'parent',
        status: ScenarioStatus.DRAFT,
      });
    });

    it('creates a blank draft with mappedEvents:[] when empty', async () => {
      await service.createVersion(10, { empty: true, name: 'from scratch' }, 1);

      const created = txVersionRepo.create.mock.calls[0][0];
      expect(created.parentVersionId).toBeNull();
      // Blank config except the explicit empty event set + forced DRAFT status.
      expect(created.config).toEqual({
        mappedEvents: [],
        status: ScenarioStatus.DRAFT,
      });
      // Did not branch or reconstruct from the live scenario.
      expect(scenarioService.getAdminScenario).not.toHaveBeenCalled();
    });

    it('reconstructs config from the live scenario when no parent and none published', async () => {
      const liveScenario = { ...scenario, publishedVersionId: null };
      (scenariosRepo.findOne as jest.Mock).mockResolvedValue(liveScenario);
      (scenarioService.getAdminScenario as jest.Mock).mockResolvedValue({
        title: 'live',
        metadata: { name: 'Ahana' },
        triggerWarnings: [{ id: 't1' }],
        terminationEvents: [],
        behaviorInstructions: [],
      });

      await service.createVersion(10, {}, 1);

      const created = txVersionRepo.create.mock.calls[0][0];
      expect(created.config).toMatchObject({
        title: 'live',
        name: 'Ahana',
        triggerWarningIds: ['t1'],
        status: ScenarioStatus.DRAFT,
      });
    });
  });

  describe('updateVersion', () => {
    it('rejects editing a non-draft version', async () => {
      (versionRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'v1',
        scenarioId: 10,
        status: ScenarioVersionStatus.PUBLISHED,
      });

      await expect(
        service.updateVersion(10, 'v1', { config: {} }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('saves config on a draft, forcing DRAFT status', async () => {
      const draft = {
        id: 'v1',
        scenarioId: 10,
        status: ScenarioVersionStatus.DRAFT,
        config: {},
      };
      (versionRepo.findOne as jest.Mock).mockResolvedValue(draft);
      versionRepo.save = jest.fn((x: any) => Promise.resolve(x));

      await service.updateVersion(
        10,
        'v1',
        { config: { title: 'x', status: ScenarioStatus.ACTIVE } },
        1,
      );

      expect((versionRepo.save as jest.Mock).mock.calls[0][0].config).toEqual({
        title: 'x',
        status: ScenarioStatus.DRAFT,
      });
    });
  });

  describe('deleteVersion', () => {
    it('refuses to delete the published version', async () => {
      (versionRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'v1',
        scenarioId: 10,
        status: ScenarioVersionStatus.PUBLISHED,
      });

      await expect(service.deleteVersion(10, 'v1', 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('publishVersion', () => {
    it('replays config via updateScenario, demotes prior, points scenario at it', async () => {
      (versionRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'v-new',
        scenarioId: 10,
        config: { title: 'draft', status: ScenarioStatus.DRAFT },
      });

      await service.publishVersion(10, 'v-new', 1);

      // Live scenario materialised with status forced ACTIVE, inside the
      // shared publish transaction (4th arg = the EntityManager).
      expect(scenarioService.updateScenario).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ status: ScenarioStatus.ACTIVE }),
        1,
        expect.anything(),
      );
      // Prior published version demoted to ARCHIVED.
      expect(txVersionRepo.update).toHaveBeenCalledWith(
        { scenarioId: 10, status: ScenarioVersionStatus.PUBLISHED },
        expect.objectContaining({ status: ScenarioVersionStatus.ARCHIVED }),
      );
      // This version marked PUBLISHED and scenario pointer updated.
      expect(txVersionRepo.update).toHaveBeenCalledWith(
        'v-new',
        expect.objectContaining({ status: ScenarioVersionStatus.PUBLISHED }),
      );
      expect(txScenarioRepo.update).toHaveBeenCalledWith(10, {
        publishedVersionId: 'v-new',
      });
    });

    it('materialises config.mappedEvents to the live scenario on publish', async () => {
      const events = [{ id: 'evt-1', feedbackStatus: true, score: 80 }];
      (versionRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'v-new',
        scenarioId: 10,
        config: { title: 'draft', mappedEvents: events },
      });

      await service.publishVersion(10, 'v-new', 1);

      expect(scenarioService.mapEventsToScenario).toHaveBeenCalledWith(
        { scenarioId: 10, events },
        expect.anything(),
      );
    });

    it('skips event materialisation when the version has no mappedEvents', async () => {
      (versionRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'v-new',
        scenarioId: 10,
        config: { title: 'draft' },
      });

      await service.publishVersion(10, 'v-new', 1);

      expect(scenarioService.mapEventsToScenario).not.toHaveBeenCalled();
      expect(scenarioService.deleteScenarioEvents).not.toHaveBeenCalled();
    });

    it('full-replaces events on publish: deletes live events absent from the draft', async () => {
      // Live has evt-old + evt-keep; the draft keeps only evt-keep.
      (scenarioService.getScenarioEvents as jest.Mock).mockResolvedValue({
        data: [{ eventId: 'evt-old' }, { eventId: 'evt-keep' }],
        count: 2,
      });
      (versionRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'v-new',
        scenarioId: 10,
        config: { mappedEvents: [{ id: 'evt-keep' }] },
      });

      await service.publishVersion(10, 'v-new', 1);

      expect(scenarioService.deleteScenarioEvents).toHaveBeenCalledWith(
        { scenarioId: 10, eventIds: ['evt-old'] },
        expect.anything(),
      );
      expect(scenarioService.mapEventsToScenario).toHaveBeenCalledWith(
        { scenarioId: 10, events: [{ id: 'evt-keep' }] },
        expect.anything(),
      );
    });
  });
});
