import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  HELPLINE_LANGUAGES,
  HELPLINE_LIMITS,
} from '../constants/helpline.constants';
import { HelplineListenerProfile } from '../entity/helpline-listener-profile.entity';
import { ListenerProfileDto } from '../type/helpline.types';
import { badRequest } from '../util/helpline-errors';

const DEFAULT_MAX_CONCURRENT = 2;

/** First name only — the alias a talker sees must never be a full name or email. */
export function defaultAlias(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return (first || 'Listener').slice(0, HELPLINE_LIMITS.DISPLAY_NAME_MAX_CHARS);
}

/**
 * Listener profiles (alias, chat limit, languages). A missing row reads as
 * defaults; the row is written on the first save.
 */
@Injectable()
export class HelplineProfileService {
  constructor(
    @InjectRepository(HelplineListenerProfile)
    private readonly profiles: Repository<HelplineListenerProfile>,
    private readonly dataSource: DataSource,
  ) {}

  async getProfile(
    tenantId: string,
    userId: number,
    orgMaxConcurrent: number,
  ): Promise<ListenerProfileDto> {
    const row = await this.profiles.findOne({ where: { tenantId, userId } });
    if (row) return this.toDto(row, orgMaxConcurrent);
    const name = await this.userName(userId);
    return {
      displayName: defaultAlias(name),
      maxConcurrentChats: Math.min(DEFAULT_MAX_CONCURRENT, orgMaxConcurrent),
      languages: [],
      notificationsEnabled: true,
    };
  }

  /**
   * Profiles for many listeners at once (the monitor roster). Users with no
   * row get the same defaults `getProfile` gives, named from `names`.
   */
  async getProfiles(
    tenantId: string,
    users: { id: number; name: string }[],
    orgMaxConcurrent: number,
  ): Promise<Map<number, ListenerProfileDto>> {
    const out = new Map<number, ListenerProfileDto>();
    if (!users.length) return out;
    const rows = await this.profiles.find({
      where: { tenantId, userId: In(users.map((u) => u.id)) },
    });
    rows.forEach((row) =>
      out.set(row.userId, this.toDto(row, orgMaxConcurrent)),
    );
    for (const user of users) {
      if (out.has(user.id)) continue;
      out.set(user.id, {
        displayName: defaultAlias(user.name),
        maxConcurrentChats: Math.min(DEFAULT_MAX_CONCURRENT, orgMaxConcurrent),
        languages: [],
        notificationsEnabled: true,
      });
    }
    return out;
  }

  /** `min(profile.max, org cap)` — the claim's capacity limit. */
  async capacity(
    tenantId: string,
    userId: number,
    orgMaxConcurrent: number,
  ): Promise<number> {
    return (await this.getProfile(tenantId, userId, orgMaxConcurrent))
      .maxConcurrentChats;
  }

  async updateProfile(
    tenantId: string,
    userId: number,
    orgMaxConcurrent: number,
    patch: Partial<ListenerProfileDto>,
  ): Promise<ListenerProfileDto> {
    const current = await this.getProfile(tenantId, userId, orgMaxConcurrent);
    const next: ListenerProfileDto = { ...current };

    if (patch.displayName !== undefined) {
      const alias = String(patch.displayName).trim();
      if (!alias || alias.length > HELPLINE_LIMITS.DISPLAY_NAME_MAX_CHARS) {
        throw badRequest(
          `displayName must be 1 to ${HELPLINE_LIMITS.DISPLAY_NAME_MAX_CHARS} characters`,
        );
      }
      next.displayName = alias;
    }
    if (patch.maxConcurrentChats !== undefined) {
      const max = patch.maxConcurrentChats;
      if (!Number.isInteger(max) || max < 1 || max > orgMaxConcurrent) {
        throw badRequest(
          `maxConcurrentChats must be a whole number from 1 to ${orgMaxConcurrent} (the organisation's limit)`,
        );
      }
      next.maxConcurrentChats = max;
    }
    if (patch.languages !== undefined) {
      const languages = patch.languages;
      if (
        !Array.isArray(languages) ||
        !languages.every((l) =>
          (HELPLINE_LANGUAGES as readonly string[]).includes(l),
        )
      ) {
        throw badRequest(
          `languages must be codes from ${HELPLINE_LANGUAGES.join(', ')}`,
        );
      }
      next.languages = [...new Set(languages)];
    }
    if (patch.notificationsEnabled !== undefined) {
      if (typeof patch.notificationsEnabled !== 'boolean') {
        throw badRequest('notificationsEnabled must be true or false');
      }
      next.notificationsEnabled = patch.notificationsEnabled;
    }

    const existing = await this.profiles.findOne({
      where: { tenantId, userId },
    });
    await this.profiles.save(
      this.profiles.create({
        ...(existing ?? {}),
        tenantId,
        userId,
        displayName: next.displayName,
        maxConcurrentChats: next.maxConcurrentChats,
        languages: next.languages,
        notificationsEnabled: next.notificationsEnabled,
      }),
    );
    return next;
  }

  /**
   * Aliases for many users at once (sender names, lobby, monitor). Users with
   * no profile get their first name. Scoped to the tenant for profile rows;
   * the user lookup is by id only and returns names, never emails.
   */
  async aliases(
    tenantId: string,
    userIds: number[],
  ): Promise<Map<number, string>> {
    const ids = [...new Set(userIds.filter((id) => Number.isInteger(id)))];
    const out = new Map<number, string>();
    if (!ids.length) return out;
    const rows = await this.profiles.find({
      where: { tenantId, userId: In(ids) },
      select: ['userId', 'displayName'],
    });
    rows.forEach((row) => out.set(row.userId, row.displayName));
    const missing = ids.filter((id) => !out.has(id));
    if (missing.length) {
      const users: { id: number; name: string }[] = await this.dataSource.query(
        `SELECT id, name FROM users WHERE id = ANY($1::int[])`,
        [missing],
      );
      users.forEach((u) => out.set(Number(u.id), defaultAlias(u.name)));
    }
    return out;
  }

  private toDto(
    row: HelplineListenerProfile,
    orgMaxConcurrent: number,
  ): ListenerProfileDto {
    return {
      displayName: row.displayName,
      maxConcurrentChats: Math.max(
        1,
        Math.min(row.maxConcurrentChats, orgMaxConcurrent),
      ),
      languages: row.languages ?? [],
      notificationsEnabled: row.notificationsEnabled,
    };
  }

  private async userName(userId: number): Promise<string | null> {
    const rows: { name: string }[] = await this.dataSource.query(
      `SELECT name FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return rows?.[0]?.name ?? null;
  }
}
