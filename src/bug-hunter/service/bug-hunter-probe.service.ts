import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AwsLogServiceKey } from 'src/config/config.service';
import { LogsService } from 'src/logs/logs.service';

import {
  PIPELINE_PROBES,
  PIPELINE_PROBE_NAMES,
} from '../constants/bug-hunter-probes.constants';
import { redactPii } from '../util/redact-pii.util';
import { ELIGBLE_APP_LANGUAGES } from 'src/common/constants/translation.constants';

const LOG_SERVICES: AwsLogServiceKey[] = [
  'ally-be',
  'ally-ai',
  'ally-ai-learn',
];
const STATEMENT_TIMEOUT_MS = 5000;
const MAX_LIMIT = 50;
const MAX_LOG_MINUTES = 24 * 60;

export type ProbeParams = Record<string, string | undefined>;

const clip = (value: unknown, max = 200): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim().length > max
      ? `${value.trim().slice(0, max - 1)}…`
      : value.trim()
    : null;

const limitOf = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0
    ? Math.min(Math.floor(n), MAX_LIMIT)
    : fallback;
};

/**
 * Bug Hunter's read-only window onto live data and logs — the tools a run
 * calls to LOCATE a fault before anyone writes a fix (see PIPELINE_PROBES for
 * the catalogue and the rules).
 *
 * Every database probe runs a fixed query inside a READ ONLY transaction with
 * a short statement timeout and is rolled back, so a probe cannot write and
 * cannot hold a lock for long, whatever a model asks of it. Answers are ids,
 * counts and authored text — simulation titles, tooltip locations,
 * permission names — never a learner's data.
 */
@Injectable()
export class BugHunterProbeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logsService: LogsService,
  ) {}

  catalogue() {
    return PIPELINE_PROBES;
  }

  async run(
    name: string,
    params: ProbeParams,
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'scenario-translations':
        return this.scenarioTranslations(params);
      case 'tooltip-translations':
        return this.tooltipTranslations(params);
      case 'role-permissions':
        return this.rolePermissions(params);
      case 'org-preferences':
        return this.orgPreferences(params);
      case 'languages':
        return this.languages();
      case 'recent-errors':
        return this.recentErrors(params);
      default:
        throw new BadRequestException(
          `No probe called "${name}". Probes: ${PIPELINE_PROBE_NAMES.join(', ')}.`,
        );
    }
  }

  /** A fixed query in a read-only, short-lived transaction that is always rolled back. */
  private async read<T = any>(sql: string, args: unknown[]): Promise<T[]> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await runner.query('SET TRANSACTION READ ONLY');
      await runner.query(
        `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
      );
      return (await runner.query(sql, args)) as T[];
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }

  private async language(code: string | undefined) {
    const wanted = clip(code, 16);
    if (!wanted)
      throw new BadRequestException('languageCode is required, e.g. mr.');
    const rows = await this.read<{
      id: number;
      translationCode: string;
      value: string;
    }>(
      `SELECT id, "translationCode", value FROM languages
        WHERE lower("translationCode") = lower($1) OR lower(value) = lower($1)
        ORDER BY active DESC, id ASC`,
      [wanted],
    );
    if (!rows.length) {
      throw new BadRequestException(
        `No language with translationCode or value "${wanted}". Call the "languages" probe for the list.`,
      );
    }
    return {
      code: rows[0].translationCode,
      ids: rows.map((r) => Number(r.id)),
      value: rows[0].value,
    };
  }

  private async scenarioTranslations(params: ProbeParams) {
    const lang = await this.language(params.languageCode);
    const tenant = clip(params.tenant, 64) ?? 'ally';
    const limit = limitOf(params.limit, 25);
    const scenarioId = params.scenarioId ? Number(params.scenarioId) : null;
    if (params.scenarioId && !Number.isFinite(scenarioId)) {
      throw new BadRequestException('scenarioId must be a number.');
    }
    const rows = await this.read<{
      id: number;
      title: string | null;
      voices: Record<string, string | null> | null;
      column_entry: { title?: string } | null;
      row_titles: string[] | null;
    }>(
      `SELECT s.id, s.title,
              s.metadata->'languageVoices' AS voices,
              s.translations->$2 AS column_entry,
              (SELECT array_agg(st.metadata->>'title')
                 FROM scenario_translations st
                WHERE st."scenarioId" = s.id AND st."languageId" = ANY($3)) AS row_titles
         FROM scenarios s
         JOIN scenario_tenants t ON t."scenarioId" = s.id AND t."tenantId" = $1
        WHERE s.status = 'ACTIVE' AND s."deletedAt" IS NULL
          AND ($4::int IS NULL OR s.id = $4::int)
        ORDER BY s.id DESC`,
      [tenant, lang.code, lang.ids, scenarioId],
    );
    const configured = rows.filter((r) =>
      lang.ids.some((id) => {
        const voice = r.voices?.[String(id)];
        return typeof voice === 'string' && voice.trim() !== '';
      }),
    );
    const hasColumn = (r: (typeof rows)[number]) =>
      Boolean(clip(r.column_entry?.title));
    const hasRow = (r: (typeof rows)[number]) =>
      Boolean(r.row_titles?.some((t) => clip(t)));
    // App-picker languages get a title for every simulation, voice or not.
    const isAppLanguage = ELIGBLE_APP_LANGUAGES.includes(lang.code);
    const expected = isAppLanguage ? rows : configured;
    const missing = expected.filter((r) => !hasColumn(r));
    return {
      language: lang,
      tenant,
      activeScenarios: rows.length,
      configuredForLanguage: configured.length,
      expectedForLanguage: expected.length,
      withServedTranslation: expected.length - missing.length,
      withTranslationRow: configured.filter(hasRow).length,
      missingCount: missing.length,
      missing: missing.slice(0, limit).map((r) => ({
        id: Number(r.id),
        title: clip(r.title, 120),
        hasTranslationRow: hasRow(r),
        servedTitle: clip(r.title, 120),
      })),
      sample: expected
        .filter(hasColumn)
        .slice(0, 3)
        .map((r) => ({
          id: Number(r.id),
          servedTitle: clip(r.column_entry?.title, 120),
        })),
      howToRead:
        'A learner is served scenarios.translations[code].title (applyScenarioTranslations). "missing" are simulations that will show English: for an app-picker language (hi/mr/ta/kn) every ACTIVE simulation is expected to have a title, otherwise only those configured with a voice for it. A backfill is POST /api/v1/learn/scenarios/translations/backfill (super admin). A translation row without a served entry means the mirror into scenarios.translations never ran. Only persistTranslationsForScenarios in ally-be src/learn/service/scenario.service.ts writes either.',
    };
  }

  private async tooltipTranslations(params: ProbeParams) {
    const lang = await this.language(params.languageCode);
    const limit = limitOf(params.limit, 25);
    const rows = await this.read<{
      id: string;
      location: string;
      translated: boolean;
    }>(
      `SELECT t.id, t.location,
              EXISTS (SELECT 1 FROM tooltip_translations tt
                       WHERE tt."tooltipId" = t.id AND tt."languageId" = ANY($1)
                         AND coalesce(trim(tt."tipText"), '') <> '') AS translated
         FROM tooltips t
        WHERE t.active = true
        ORDER BY t.location ASC`,
      [lang.ids],
    );
    const missing = rows.filter((r) => !r.translated);
    return {
      language: lang,
      activeTooltips: rows.length,
      translated: rows.length - missing.length,
      missingCount: missing.length,
      missing: missing
        .slice(0, limit)
        .map((r) => ({ id: r.id, location: r.location })),
      howToRead:
        'Tooltips are content in the tooltips / tooltip_translations tables, edited under Manage Tooltips. A missing translation is a data repair or a translation job, never a locale-file entry.',
    };
  }

  private async rolePermissions(params: ProbeParams) {
    const role = clip(params.role, 80);
    const permission = clip(params.permission, 120);
    if (!role && !permission) {
      throw new BadRequestException(
        'Pass role (a group name) or permission (an exact permission name).',
      );
    }
    if (permission) {
      const rows = await this.read<{ name: string }>(
        `SELECT DISTINCT g.name FROM groups g
           JOIN group_permissions gp ON gp."groupId" = g.id
           JOIN permissions p ON p.id = gp."permissionId"
          WHERE p.name = $1 ORDER BY g.name`,
        [permission],
      );
      return {
        permission,
        roles: rows.map((r) => r.name),
        howToRead:
          'Roles that hold this permission today. A cloned role missing a grant its source has is the commonest "403 for one role" cause; role lookups are cached in Redis for 30 minutes after a migration.',
      };
    }
    const rows = await this.read<{ role: string; permission: string }>(
      `SELECT g.name AS role, p.name AS permission FROM groups g
         JOIN group_permissions gp ON gp."groupId" = g.id
         JOIN permissions p ON p.id = gp."permissionId"
        WHERE g.name ILIKE $1 ORDER BY g.name, p.name`,
      [`%${role}%`],
    );
    const byRole: Record<string, string[]> = {};
    for (const r of rows) (byRole[r.role] ??= []).push(r.permission);
    return { role, roles: byRole };
  }

  private async orgPreferences(params: ProbeParams) {
    const tenant = clip(params.tenant, 64) ?? 'ally';
    const rows = await this.read<{
      name: string;
      value: { enabled?: boolean } | null;
    }>(
      `SELECT p.name, p.value FROM preference p
        WHERE p."relatedEntity" = 'ORGANIZATION'
          AND p."relatedId" IN ($1, (SELECT code FROM tenants WHERE id::text = $1 LIMIT 1))
        ORDER BY p.name`,
      [tenant],
    );
    return {
      tenant,
      preferences: rows.map((r) => ({
        name: r.name,
        enabled:
          r.value && typeof r.value === 'object'
            ? (r.value.enabled ?? null)
            : null,
      })),
      howToRead: 'A preference with no row is OFF: org toggles fail closed.',
    };
  }

  private async languages() {
    const rows = await this.read<{
      id: number;
      value: string;
      translationCode: string;
      active: boolean;
    }>(
      `SELECT id, value, "translationCode", active FROM languages ORDER BY id`,
      [],
    );
    return { languages: rows.map((r) => ({ ...r, id: Number(r.id) })) };
  }

  private async recentErrors(params: ProbeParams) {
    const service = params.service as AwsLogServiceKey;
    if (!LOG_SERVICES.includes(service)) {
      throw new BadRequestException(
        `service must be one of ${LOG_SERVICES.join(', ')}.`,
      );
    }
    const minutes = Math.min(
      Math.max(Number(params.minutes) || 60, 1),
      MAX_LOG_MINUTES,
    );
    const limit = limitOf(params.limit, 30);
    const endTime = Date.now();
    const { events } = await this.logsService.getLogEvents({
      service,
      startTime: endTime - minutes * 60 * 1000,
      endTime,
      level: 'ERROR',
      search: clip(params.search, 120) ?? undefined,
      limit,
    } as never);
    return {
      service,
      minutes,
      count: events.length,
      events: events.slice(0, limit).map((e: any) => ({
        at: new Date(e.timestamp).toISOString(),
        message: clip(redactPii(String(e.message ?? '')), 600),
      })),
    };
  }
}
