import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import {
  HELPLINE_TIMINGS,
  HelplinePresence,
} from '../constants/helpline.constants';

export type HelplineConnKind = 'listener' | 'talker';
type StoredPresence = HelplinePresence.AVAILABLE | HelplinePresence.AWAY;

/**
 * Presence, connection liveness, typing and once-flags in Redis (contract
 * §6.4). Redis rather than memory because a listener's sockets and the
 * lifecycle sweep can be on different replicas.
 *
 *  - `hl:presence:{tenantId}` hash: userId → `{ status, at }` (what they chose)
 *  - `hl:conn:{listener|talker}:{id}`: `1` EX 45, refreshed on connect and on
 *    every HEARTBEAT (15 s), deleted on the last local disconnect
 *  - `hl:gone:{listener|talker}:{id}`: when the connection was first seen
 *    missing. Written on disconnect, or by the sweep when a conn key simply
 *    expired — which is how a crashed replica's sockets are noticed.
 *  - `hl:typing:{chatId}:listener`: EX 4
 *  - `hl:flag:{chatId}:{name}`: per-chat "already did this once" markers
 *  - `hl:status:{tenantId}`: the public status, cached 10 s
 *
 * A listener is AVAILABLE iff their stored presence is AVAILABLE AND their conn
 * key is live. A raw ioredis client (created lazily, so nothing connects at
 * module load) because RedisService has no hset/hdel/exists/NX-with-value;
 * keys get the same `<REDIS_PREFIX>:` prefix RedisService uses.
 */
@Injectable()
export class HelplinePresenceService implements OnModuleDestroy {
  private client: Redis | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: AppConfigService,
  ) {}

  private get redis(): Redis {
    if (!this.client) this.client = this.redisService.createClient('helpline');
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => undefined);
  }

  key(...parts: (string | number)[]): string {
    return `${this.configService.redis.prefix}:hl:${parts.join(':')}`;
  }

  // ── Presence ──────────────────────────────────────────────────────────────

  async setPresence(
    tenantId: string,
    userId: number,
    status: StoredPresence,
  ): Promise<void> {
    await this.redis.hset(
      this.key('presence', tenantId),
      String(userId),
      JSON.stringify({ status, at: new Date().toISOString() }),
    );
  }

  /** What the listener chose; AWAY until they say otherwise. */
  async getStoredPresence(
    tenantId: string,
    userId: number,
  ): Promise<StoredPresence> {
    const raw = await this.redis.hget(
      this.key('presence', tenantId),
      String(userId),
    );
    return parseStatus(raw);
  }

  /** OFFLINE when no socket is live, else the stored choice. */
  async getPresence(
    tenantId: string,
    userId: number,
  ): Promise<HelplinePresence> {
    const [stored, live] = await Promise.all([
      this.getStoredPresence(tenantId, userId),
      this.isConnected('listener', userId),
    ]);
    return live ? stored : HelplinePresence.OFFLINE;
  }

  /** Every listener with a stored presence in the tenant, with liveness. */
  async listPresence(
    tenantId: string,
  ): Promise<{ userId: number; presence: HelplinePresence }[]> {
    const all = await this.redis.hgetall(this.key('presence', tenantId));
    const userIds = Object.keys(all).map(Number).filter(Number.isFinite);
    const live = await this.connectedMany('listener', userIds);
    return userIds.map((userId) => ({
      userId,
      presence: live.get(userId)
        ? parseStatus(all[String(userId)])
        : HelplinePresence.OFFLINE,
    }));
  }

  async availableListenerIds(tenantId: string): Promise<number[]> {
    const all = await this.listPresence(tenantId);
    return all
      .filter((p) => p.presence === HelplinePresence.AVAILABLE)
      .map((p) => p.userId);
  }

  async isAvailable(tenantId: string, userId: number): Promise<boolean> {
    return (
      (await this.getPresence(tenantId, userId)) === HelplinePresence.AVAILABLE
    );
  }

  // ── Connection liveness ──────────────────────────────────────────────────

  async touchConnection(
    kind: HelplineConnKind,
    id: string | number,
  ): Promise<void> {
    await this.redis
      .multi()
      .set(
        this.key('conn', kind, id),
        '1',
        'EX',
        HELPLINE_TIMINGS.CONN_TTL_SECONDS,
      )
      .del(this.key('gone', kind, id))
      .exec();
  }

  /** The last local socket went away: mark missing-since now (keeps an earlier mark). */
  async dropConnection(
    kind: HelplineConnKind,
    id: string | number,
  ): Promise<void> {
    await this.redis
      .multi()
      .del(this.key('conn', kind, id))
      .set(
        this.key('gone', kind, id),
        new Date().toISOString(),
        'EX',
        HELPLINE_TIMINGS.GONE_TTL_SECONDS,
        'NX',
      )
      .exec();
  }

  async isConnected(
    kind: HelplineConnKind,
    id: string | number,
  ): Promise<boolean> {
    return (await this.redis.exists(this.key('conn', kind, id))) === 1;
  }

  async connectedMany<T extends string | number>(
    kind: HelplineConnKind,
    ids: T[],
  ): Promise<Map<T, boolean>> {
    const out = new Map<T, boolean>();
    if (!ids.length) return out;
    const values = await this.redis.mget(
      ids.map((id) => this.key('conn', kind, id)),
    );
    ids.forEach((id, i) => out.set(id, values[i] != null));
    return out;
  }

  /**
   * null when connected. Otherwise when the participant was first seen
   * missing — recording "now" if nothing has yet (a conn key that expired
   * because its replica died never got a disconnect).
   */
  async goneSince(
    kind: HelplineConnKind,
    id: string | number,
  ): Promise<Date | null> {
    if (await this.isConnected(kind, id)) return null;
    const goneKey = this.key('gone', kind, id);
    const now = new Date().toISOString();
    await this.redis.set(
      goneKey,
      now,
      'EX',
      HELPLINE_TIMINGS.GONE_TTL_SECONDS,
      'NX',
    );
    const value = await this.redis.get(goneKey);
    const at = new Date(value ?? now);
    return Number.isNaN(at.getTime()) ? new Date(now) : at;
  }

  /** True when this participant had a missing-since mark (i.e. this is a reconnect). */
  async wasGone(kind: HelplineConnKind, id: string | number): Promise<boolean> {
    return (await this.redis.exists(this.key('gone', kind, id))) === 1;
  }

  // ── Typing ───────────────────────────────────────────────────────────────

  async setListenerTyping(chatId: string): Promise<void> {
    await this.redis.set(
      this.key('typing', chatId, 'listener'),
      '1',
      'EX',
      HELPLINE_TIMINGS.TYPING_TTL_SECONDS,
    );
  }

  async clearListenerTyping(chatId: string): Promise<void> {
    await this.redis.del(this.key('typing', chatId, 'listener'));
  }

  async isListenerTyping(chatId: string): Promise<boolean> {
    return (
      (await this.redis.exists(this.key('typing', chatId, 'listener'))) === 1
    );
  }

  // ── Per-chat once-flags ──────────────────────────────────────────────────

  async hasFlag(chatId: string, name: string): Promise<boolean> {
    return (await this.redis.exists(this.key('flag', chatId, name))) === 1;
  }

  async flags(
    chatId: string,
    names: string[],
  ): Promise<Record<string, boolean>> {
    const values = await this.redis.mget(
      names.map((n) => this.key('flag', chatId, n)),
    );
    return Object.fromEntries(names.map((n, i) => [n, values[i] != null]));
  }

  /** Sets the flag; false when it was already set (so callers act once). */
  async setFlagOnce(chatId: string, name: string): Promise<boolean> {
    const result = await this.redis.set(
      this.key('flag', chatId, name),
      '1',
      'EX',
      HELPLINE_TIMINGS.FLAG_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  async clearFlag(chatId: string, name: string): Promise<boolean> {
    return (await this.redis.del(this.key('flag', chatId, name))) > 0;
  }

  // ── Public status cache ──────────────────────────────────────────────────

  async getCachedStatus<T>(tenantId: string): Promise<T | null> {
    const raw = await this.redis.get(this.key('status', tenantId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setCachedStatus(tenantId: string, value: unknown): Promise<void> {
    await this.redis.set(
      this.key('status', tenantId),
      JSON.stringify(value),
      'EX',
      HELPLINE_TIMINGS.STATUS_CACHE_TTL_SECONDS,
    );
  }

  /** Called on every presence / queue change so `open` flips promptly. */
  async invalidateStatus(tenantId: string): Promise<void> {
    await this.redis.del(this.key('status', tenantId));
  }
}

function parseStatus(raw: string | null | undefined): StoredPresence {
  if (!raw) return HelplinePresence.AWAY;
  try {
    const parsed = JSON.parse(raw) as { status?: string };
    return parsed.status === HelplinePresence.AVAILABLE
      ? HelplinePresence.AVAILABLE
      : HelplinePresence.AWAY;
  } catch {
    return HelplinePresence.AWAY;
  }
}
