import { BadRequestException } from '@nestjs/common';

import { BugHunterProbeService } from '../bug-hunter-probe.service';

/**
 * The probes are Bug Hunter's window onto production data, so the tests pin
 * the two things that make them safe — every query runs read-only, short and
 * rolled back, and nothing outside the catalogue runs — and the one answer
 * that would have located the 2026-10-12 translations bug by itself.
 */
describe('BugHunterProbeService', () => {
  let runner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    query: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    isTransactionActive: boolean;
  };
  let answers: unknown[][];
  let logs: { getLogEvents: jest.Mock };
  let service: BugHunterProbeService;

  beforeEach(() => {
    answers = [];
    runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.startsWith('SET ') ? [] : (answers.shift() ?? [])),
      ),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isTransactionActive: true,
    };
    logs = { getLogEvents: jest.fn().mockResolvedValue({ events: [] }) };
    service = new BugHunterProbeService(
      { createQueryRunner: () => runner } as never,
      logs as never,
    );
  });

  const marathi = [{ id: 5, translationCode: 'mr', value: 'mr-IN' }];

  it('runs every query read-only, with a statement timeout, and always rolls back', async () => {
    answers = [
      [{ id: 1, value: 'en-IN', translationCode: 'en', active: true }],
    ];
    await service.run('languages', {});
    const sql = runner.query.mock.calls.map(([q]) => q);
    expect(sql[0]).toBe('SET TRANSACTION READ ONLY');
    expect(sql[1]).toMatch(/SET LOCAL statement_timeout = \d+/);
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('refuses a probe that is not in the catalogue', async () => {
    await expect(service.run('drop-table', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('names the simulations configured for a language that would show English — the 2026-10-12 fault', async () => {
    answers = [
      marathi,
      [
        // configured for Marathi, no served entry: the bug
        {
          id: 111,
          title: '[Demo] Help Sandeep',
          voices: { '1': 'v1', '5': 'v5' },
          column_entry: null,
          row_titles: null,
        },
        // configured and translated
        {
          id: 38,
          title: 'Build rapport with Meera',
          voices: { '5': 'v5' },
          column_entry: { title: 'मीरा' },
          row_titles: ['मीरा'],
        },
        // a row exists but the served entry was never mirrored
        {
          id: 58,
          title: 'Healthier habits',
          voices: { '5': 'v5' },
          column_entry: null,
          row_titles: ['सवयी'],
        },
        // no Marathi voice, but Marathi is an app-picker language: still expected
        {
          id: 7,
          title: 'English only',
          voices: { '1': 'v1', '5': null },
          column_entry: null,
          row_titles: null,
        },
      ],
    ];
    const r = await service.run('scenario-translations', {
      languageCode: 'mr',
    });
    expect(r).toMatchObject({
      activeScenarios: 4,
      configuredForLanguage: 3,
      expectedForLanguage: 4,
      withServedTranslation: 1,
      withTranslationRow: 2,
      missingCount: 3,
    });
    expect(
      (r.missing as { id: number; hasTranslationRow: boolean }[]).map((m) => [
        m.id,
        m.hasTranslationRow,
      ]),
    ).toEqual([
      [111, false],
      [58, true],
      [7, false],
    ]);
    // tenant defaults to ally and the language code is passed as a parameter, never spliced
    const call = runner.query.mock.calls.find(([q]) =>
      String(q).includes('FROM scenarios'),
    );
    expect(call?.[1]).toEqual(['ally', 'mr', [5], null]);
  });

  it('asks for a language it knows, and says how to find one', async () => {
    answers = [[]];
    await expect(
      service.run('scenario-translations', { languageCode: 'xx' }),
    ).rejects.toThrow(/"languages" probe/);
    await expect(service.run('tooltip-translations', {})).rejects.toThrow(
      /languageCode is required/,
    );
  });

  it('lists the roles holding a permission', async () => {
    answers = [[{ name: 'Multi Tenant Admin' }, { name: 'Super Admin' }]];
    const r = await service.run('role-permissions', {
      permission: 'view:scenario-voices',
    });
    expect(r.roles).toEqual(['Multi Tenant Admin', 'Super Admin']);
    await expect(service.run('role-permissions', {})).rejects.toThrow(
      /role .* or permission/,
    );
  });

  it('reads backend errors only, within a capped window, with PII redacted and messages clipped', async () => {
    logs.getLogEvents.mockResolvedValue({
      events: [
        {
          timestamp: Date.UTC(2026, 9, 13, 4, 7),
          message: `DATABASE_ERROR for jane@example.com ${'x'.repeat(900)}`,
        },
      ],
    });
    const r = await service.run('recent-errors', {
      service: 'ally-be',
      minutes: '99999',
      search: 'bug-reports',
    });
    expect(r.minutes).toBe(1440);
    const [arg] = logs.getLogEvents.mock.calls[0];
    expect(arg).toMatchObject({
      service: 'ally-be',
      level: 'ERROR',
      search: 'bug-reports',
    });
    const [event] = r.events as { message: string }[];
    expect(event.message).not.toContain('jane@example.com');
    expect(event.message.length).toBeLessThanOrEqual(600);
    await expect(
      service.run('recent-errors', { service: 'ally-web' }),
    ).rejects.toThrow(/service must be one of/);
  });
});
