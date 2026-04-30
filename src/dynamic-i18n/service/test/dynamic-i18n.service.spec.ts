import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import { AppConfigService } from 'src/config/config.service';
import { User } from 'src/user/entity/user.entity';
import { Repository } from 'typeorm';
import { DynamicI18nService } from '../dynamic-i18n.service';

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
};

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

describe('DynamicI18nService', () => {
  let tempDir: string;
  let rootDir: string;
  let sourceDir: string;
  let service: DynamicI18nService;
  let auditLogService: jest.Mocked<
    Pick<AuditLogService, 'log' | 'listByEventTypes'>
  >;
  let userRepository: jest.Mocked<Pick<Repository<User>, 'find'>>;

  const seedTranslations = async () => {
    await writeJson(path.join(sourceDir, 'en.json'), {
      common: {
        title: 'Hello {{name}}',
        nested: {
          cta: 'Start',
        },
      },
      dashboard: {
        heading: 'Dashboard',
      },
    });
    await writeJson(path.join(sourceDir, 'kn.json'), {
      common: {
        title: 'Namaskara {{name}}',
      },
    });
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ally-i18n-'));
    rootDir = path.join(tempDir, 'runtime');
    sourceDir = path.join(tempDir, 'seed');
    await seedTranslations();

    const config = {
      i18n: {
        rootDir,
        sourceDir,
        versionRetention: 2,
      },
    } as AppConfigService;

    auditLogService = {
      log: jest.fn().mockResolvedValue(undefined),
      listByEventTypes: jest.fn(),
    };
    userRepository = {
      find: jest.fn(),
    };

    service = new DynamicI18nService(
      config,
      auditLogService as unknown as AuditLogService,
      userRepository as unknown as Repository<User>,
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('seeds draft translations from the configured source directory', async () => {
    const status = await service.getStatus();

    expect(status.manifest).toBeNull();
    expect(status.languages).toEqual(['en', 'kn']);
    expect(status.namespaces).toEqual(['common', 'dashboard']);
    expect(status.versions).toEqual([]);
    expect(status.retentionLimit).toBe(2);

    const draft = await readJson<Record<string, unknown>>(
      path.join(rootDir, '.drafts', 'en.json'),
    );
    expect(draft).toMatchObject({
      common: {
        title: 'Hello {{name}}',
      },
    });
  });

  it('updates draft translation keys and records the change in audit logs', async () => {
    const result = await service.updateTranslations({
      language: 'en',
      namespace: 'common',
      key: 'nested.cta',
      value: 'Begin',
    });

    expect(result).toEqual({
      language: 'en',
      namespace: 'common',
      changedKeys: ['nested.cta'],
    });

    const draft = await readJson<{ common: { nested: { cta: string } } }>(
      path.join(rootDir, '.drafts', 'en.json'),
    );
    expect(draft.common.nested.cta).toBe('Begin');
    expect(auditLogService.log).toHaveBeenCalledWith({
      eventType: 'DYNAMIC_I18N_TRANSLATION_UPDATED',
      details: {
        language: 'en',
        namespace: 'common',
        changes: [
          {
            key: 'nested.cta',
            oldValue: 'Start',
            newValue: 'Begin',
          },
        ],
      },
    });
  });

  it('rejects updates that remove existing placeholders', async () => {
    await expect(
      service.updateTranslations({
        language: 'en',
        namespace: 'common',
        key: 'title',
        value: 'Hello',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(auditLogService.log).not.toHaveBeenCalled();
  });

  it('publishes immutable versions, prunes old versions, and rolls back by switching manifest', async () => {
    const firstManifest = await service.publish('first release');
    expect(firstManifest).toMatchObject({
      version: 1,
      currentVersion: 'v1',
      languages: ['en', 'kn'],
      namespaces: ['common', 'dashboard'],
    });

    await service.updateTranslations({
      language: 'en',
      namespace: 'common',
      key: 'nested.cta',
      value: 'Continue',
    });
    await service.publish('second release');

    await service.updateTranslations({
      language: 'en',
      namespace: 'common',
      key: 'nested.cta',
      value: 'Resume',
    });
    const thirdManifest = await service.publish('third release');

    expect(thirdManifest.currentVersion).toBe('v3');
    expect(await pathExists(path.join(rootDir, 'v1'))).toBe(false);
    expect(await pathExists(path.join(rootDir, 'v2'))).toBe(true);
    expect(await pathExists(path.join(rootDir, 'v3'))).toBe(true);

    const versionedCommon = await readJson<{ nested: { cta: string } }>(
      path.join(rootDir, 'v3', 'en', 'common.json'),
    );
    expect(versionedCommon.nested.cta).toBe('Resume');

    const rollbackManifest = await service.rollback(2, 'restore previous copy');
    const persistedManifest = await readJson<{ currentVersion: string }>(
      path.join(rootDir, 'manifest.json'),
    );

    expect(rollbackManifest.currentVersion).toBe('v2');
    expect(persistedManifest.currentVersion).toBe('v2');
    expect(auditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DYNAMIC_I18N_ROLLED_BACK',
        details: expect.objectContaining({
          version: 2,
          currentVersion: 'v2',
        }),
      }),
    );
  });

  it('returns compact i18n audit log entries with resolved user names', async () => {
    const loggedAt = new Date('2026-04-29T04:31:45.000Z');
    auditLogService.listByEventTypes.mockResolvedValue([
      {
        eventType: 'DYNAMIC_I18N_PUBLISHED',
        loggedAt,
        userId: 7,
      },
      {
        eventType: 'DYNAMIC_I18N_ROLLED_BACK',
        loggedAt,
        userId: null,
      },
      {
        eventType: 'UNEXPECTED_EVENT',
        loggedAt,
        userId: 8,
      },
    ] as Awaited<ReturnType<AuditLogService['listByEventTypes']>>);
    userRepository.find.mockResolvedValue([
      { id: 7, name: 'Admin User' } as User,
    ]);

    const logs = await service.getAuditLogs(20, 0);

    expect(auditLogService.listByEventTypes).toHaveBeenCalledWith(
      [
        'DYNAMIC_I18N_TRANSLATION_UPDATED',
        'DYNAMIC_I18N_PUBLISHED',
        'DYNAMIC_I18N_ROLLED_BACK',
      ],
      20,
      0,
    );
    expect(userRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: expect.any(Object) }),
        select: ['id', 'name'],
      }),
    );
    expect(logs).toEqual([
      {
        event: 'Published',
        date: loggedAt,
        userName: 'Admin User',
      },
      {
        event: 'Rolled back',
        date: loggedAt,
        userName: 'System',
      },
      {
        event: 'UNEXPECTED_EVENT',
        date: loggedAt,
        userName: 'Unknown user',
      },
    ]);
  });
});
