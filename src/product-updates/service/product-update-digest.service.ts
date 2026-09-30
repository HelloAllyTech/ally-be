import { Injectable } from '@nestjs/common';
import { And, IsNull, LessThan, MoreThanOrEqual, Not } from 'typeorm';

import { SESService } from 'src/aws/service/ses.service';
import dayjs, {
  BUSINESS_TIMEZONE,
  toBusinessDateString,
} from 'src/common/util/date.util';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';

import { LOW_CONFIDENCE } from '../constants/product-update.constants';
import { ProductUpdateSourceStatus } from '../entity/product-update-source.entity';
import { ProductUpdate } from '../entity/product-update.entity';
import { ProductUpdateSourceRepository } from '../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../repository/product-update.repository';
import { ProductUpdateLivenessService } from './product-update-liveness.service';

/** Only updates this recent are reported; anything older (a backfill) is marked announced silently. */
const REPORT_WINDOW_MS = 36 * 60 * 60 * 1000;
const LAST_SENT_KEY = 'product-updates:digest:last-sent';

/** What a waiting deployable is called in an email a non-engineer reads. */
const DEPLOYABLE_LABELS: Record<string, string> = {
  'ally-be': 'backend',
  'ally-ai': 'AI service',
  'ally-ai-learn': 'voice agent',
  'ally-web:admin': 'admin console',
  'ally-web:helpline': 'web app',
  'ally-web:web': 'marketing site',
  'ally-mobile': 'mobile store release',
};

const SURFACE_LABELS: Record<string, string> = {
  web_app: 'Web app',
  mobile_app: 'Mobile app',
  admin_console: 'Admin console',
  whatsapp: 'WhatsApp',
};

export type DigestOutcome =
  | 'disabled'
  | 'not-due'
  | 'already-sent'
  | 'nothing-to-report'
  | 'sent'
  | 'failed';

export interface DigestContent {
  subject: string;
  html: string;
  live: ProductUpdate[];
  waiting: ProductUpdate[];
}

/**
 * The team's daily email: what reached users today, what merged but is still
 * waiting on a release, and anything worth a second look.
 *
 * The public page is highlights; this is the detail and the reasoning behind
 * them — Stacks' *Adapt stakeholder communication to their role and cadence*.
 * Sent once a day at a business-timezone hour, and only on a day with
 * something to say.
 */
@Injectable()
export class ProductUpdateDigestService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdateDigestService.name,
  );

  constructor(
    private readonly updateRepository: ProductUpdateRepository,
    private readonly sourceRepository: ProductUpdateSourceRepository,
    private readonly liveness: ProductUpdateLivenessService,
    private readonly sesService: SESService,
    private readonly configService: AppConfigService,
    private readonly redisService: RedisService,
  ) {}

  /** The hourly tick: sends once, in the configured business hour, if there is anything to report. */
  async sendIfDue(now: Date = new Date()): Promise<DigestOutcome> {
    const { digestTo, digestHour } = this.configService.productUpdates;
    if (digestTo.length === 0) return 'disabled';
    if (dayjs(now).tz(BUSINESS_TIMEZONE).hour() !== digestHour)
      return 'not-due';

    const lockKey = `product-updates:digest:${toBusinessDateString(now)}`;
    if (!(await this.redisService.acquireLock(lockKey, 20 * 60 * 60))) {
      return 'already-sent';
    }

    try {
      const outcome = await this.send(now, digestTo);
      if (outcome === 'failed') await this.redisService.releaseLock(lockKey);
      return outcome;
    } catch (error) {
      await this.redisService.releaseLock(lockKey);
      throw error;
    }
  }

  /** Builds and sends a digest now, regardless of the hour. Used by the hourly tick and by tests. */
  async send(now: Date, to: string[]): Promise<DigestOutcome> {
    await this.silenceStale(now);
    const content = await this.build(now);
    if (!content) return 'nothing-to-report';

    try {
      await this.sesService.sendEmail({
        from: this.configService.email.sourceEmail,
        to,
        subject: content.subject,
        body: content.html,
        isHtml: true,
        purpose: 'product updates digest',
      });
    } catch (error) {
      this.logger.error(
        `[PRODUCT-UPDATES] Digest failed to send: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'failed';
    }

    for (const update of content.live) {
      update.announcedAt = now;
      update.announcedLive = true;
    }
    for (const update of content.waiting) update.announcedAt = now;
    await this.updateRepository.save([...content.live, ...content.waiting]);
    await this.redisService.set(LAST_SENT_KEY, now.toISOString());
    return 'sent';
  }

  /**
   * Marks as announced everything too old to report. Without this the first
   * digest after a backfill would list seven weeks of updates as "live today".
   */
  private async silenceStale(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - REPORT_WINDOW_MS);
    await this.updateRepository.update(
      { announcedLive: false, liveAt: And(Not(IsNull()), LessThan(cutoff)) },
      { announcedLive: true, announcedAt: now },
    );
    await this.updateRepository.update(
      {
        announcedAt: IsNull(),
        liveAt: IsNull(),
        lastMergedAt: LessThan(cutoff),
      },
      { announcedAt: now },
    );
  }

  async build(now: Date): Promise<DigestContent | null> {
    const cutoff = new Date(now.getTime() - REPORT_WINDOW_MS);
    const live = await this.updateRepository.find({
      where: { announcedLive: false, liveAt: MoreThanOrEqual(cutoff) },
      relations: { sources: true },
      order: { liveAt: 'ASC' },
    });
    const waiting = await this.updateRepository.find({
      where: {
        announcedAt: IsNull(),
        liveAt: IsNull(),
        lastMergedAt: MoreThanOrEqual(cutoff),
      },
      relations: { sources: true },
      order: { lastMergedAt: 'ASC' },
    });
    if (live.length === 0 && waiting.length === 0) return null;

    const lastSent = await this.redisService.get(LAST_SENT_KEY);
    const since = lastSent
      ? new Date(lastSent)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const noise = await this.sourceRepository.countNoiseSince(since);
    const counts = await this.sourceRepository.countByStatus();
    const backlog =
      counts[ProductUpdateSourceStatus.PENDING] +
      counts[ProductUpdateSourceStatus.ENRICHED];
    const pending = await this.liveness.pendingDeployablesFor(
      waiting.map((update) => update.id),
    );

    const livePublic = live.filter(
      (update) => update.audience === 'public' && !update.hidden,
    );
    const liveInternal = live.filter((update) => !livePublic.includes(update));
    const worthALook = livePublic.filter(
      (update) => update.confidence < LOW_CONFIDENCE,
    );

    const date = dayjs(now).tz(BUSINESS_TIMEZONE).format('ddd D MMM');
    const subject = `Ally product updates · ${date} — ${live.length} live, ${waiting.length} waiting`;
    const adminBase = this.configService.adminBaseUrl.replace(/\/$/, '');
    const editLink = (update: ProductUpdate) =>
      `${adminBase}/product-updates?update=${encodeURIComponent(update.id)}`;

    const sections: string[] = [];
    sections.push(
      section(
        'Live for customers',
        livePublic,
        'Nothing new reached customers.',
        (update) => card(update, editLink(update), { showPublicSummary: true }),
      ),
    );
    if (worthALook.length) {
      sections.push(
        section(
          'Worth a second look',
          worthALook,
          '',
          (update) =>
            `<p style="margin:0 0 8px"><a href="${editLink(update)}">${escapeHtml(update.title)}</a>, published automatically with low confidence (${Math.round(update.confidence * 100)}%). ${escapeHtml(update.decisionReason ?? '')}</p>`,
        ),
      );
    }
    sections.push(
      section(
        'Live for the team only',
        liveInternal,
        'Nothing internal went live.',
        (update) =>
          card(update, editLink(update), { showPublicSummary: false }),
      ),
    );
    sections.push(
      section(
        'Merged, waiting on a release',
        waiting,
        'Nothing waiting.',
        (update) =>
          card(update, editLink(update), {
            showPublicSummary: update.audience === 'public',
            waitingOn: (pending.get(update.id) ?? []).map(
              (deployable) => DEPLOYABLE_LABELS[deployable] ?? deployable,
            ),
          }),
      ),
    );

    const footer = [
      noise
        ? `${noise} change(s) since the last digest were tests, docs, lint or version bumps.`
        : null,
      backlog
        ? `${backlog} merge(s) are still being read and grouped; they will appear in a later digest.`
        : null,
      `Public updates appear on the changelog as soon as they are live. Edit or hide any of them in <a href="${adminBase}/product-updates">Admin → Product updates</a>.`,
    ]
      .filter(Boolean)
      .map(
        (line) =>
          `<p style="margin:0 0 6px;color:#6E6656;font-size:13px">${line}</p>`,
      )
      .join('');

    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#29261F;max-width:680px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(subject)}</h1>
${sections.join('\n')}
<hr style="border:none;border-top:1px solid #E3DBCE;margin:24px 0 12px">
${footer}
</div>`;

    return { subject, html, live, waiting };
  }
}

function section<T>(
  title: string,
  items: T[],
  empty: string,
  render: (item: T) => string,
): string {
  if (items.length === 0 && !empty) return '';
  const body = items.length
    ? items.map(render).join('\n')
    : `<p style="margin:0;color:#6E6656">${escapeHtml(empty)}</p>`;
  return `<h2 style="font-size:16px;margin:24px 0 10px">${escapeHtml(title)}${
    items.length ? ` (${items.length})` : ''
  }</h2>\n${body}`;
}

function card(
  update: ProductUpdate,
  editLink: string,
  options: { showPublicSummary: boolean; waitingOn?: string[] },
): string {
  const surfaces = update.surfaces
    .map((surface) => SURFACE_LABELS[surface] ?? surface)
    .join(', ');
  const meta = [capitalise(update.kind), surfaces, update.area]
    .filter(Boolean)
    .join(' · ');
  const notes = update.teamNotes
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');
  const links = (update.sources ?? [])
    .map((source) => {
      const label =
        source.prNumber !== null
          ? `${source.repo}#${source.prNumber}`
          : `${source.repo} push`;
      return source.prUrl
        ? `<a href="${escapeHtml(source.prUrl)}">${escapeHtml(label)}</a>`
        : escapeHtml(label);
    })
    .join(' · ');
  return `<div style="border:1px solid #E3DBCE;border-radius:8px;padding:12px 14px;margin:0 0 10px">
<p style="margin:0 0 4px;font-weight:600">${escapeHtml(update.title)}</p>
<p style="margin:0 0 6px;color:#6E6656;font-size:13px">${escapeHtml(meta)}${
    options.waitingOn?.length
      ? ` · waiting on the ${escapeHtml(options.waitingOn.join(' and '))}`
      : ''
  }</p>
${options.showPublicSummary ? `<p style="margin:0 0 6px">${escapeHtml(update.summary)}</p>` : ''}
${notes ? `<ul style="margin:0 0 6px;padding-left:18px">${notes}</ul>` : ''}
<p style="margin:0;font-size:12px;color:#6E6656">${links}${links ? ' · ' : ''}<a href="${escapeHtml(editLink)}">Edit</a></p>
</div>`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
