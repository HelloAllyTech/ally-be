import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { Request } from 'express';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  InboundWhatsAppMessage,
  WhatsAppConnectionCheck,
  WhatsAppProvider,
} from '../type/whatsapp-provider.interface';

/** Message types that carry no readable text. */
const UNSUPPORTED_TYPES = new Set([
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
]);

/**
 * What to do about the Meta error codes a go-live actually hits.
 *
 * Meta's own message text is accurate but written for someone who already knows the platform
 * ("(#131030) Recipient phone number not in allowed list"). These land in the Slack alert and on the
 * admin settings screen, where the reader is whoever is setting the bot up, so each one says what to
 * change rather than only what went wrong.
 */
const META_ERROR_HINTS: Record<number, string> = {
  190: 'The access token is invalid or has expired. Temporary tokens from the API Setup page last 24 hours — create a permanent System User token and update WHATSAPP_ACCESS_TOKEN.',
  10: 'The access token lacks permission. It needs whatsapp_business_messaging and whatsapp_business_management, and the System User must be assigned to the WhatsApp account.',
  200: 'The access token lacks permission. It needs whatsapp_business_messaging and whatsapp_business_management, and the System User must be assigned to the WhatsApp account.',
  131030:
    'This person\'s number is not on the allowed list. While using Meta\'s test number, add each tester under WhatsApp → API Setup → "To".',
  131047:
    'More than 24 hours have passed since this person last wrote, so Meta only allows pre-approved template messages.',
  131026:
    "Meta could not deliver to this number — it may not be on WhatsApp, or the person has not accepted WhatsApp's latest terms.",
  133010:
    'The phone number is not registered for the API yet. Use "Register number" on the bot settings screen.',
  131031:
    'Meta has locked or restricted this WhatsApp account. Check WhatsApp Manager for the reason.',
  131042:
    'There is a billing problem on the WhatsApp account. Add or fix the payment method in Meta Business Settings.',
  131056:
    'Too many messages to this one person in a short time. It clears by itself.',
  130429:
    'The number has hit its sending throughput limit. It clears by itself.',
  368: 'Meta has temporarily blocked this account for a policy violation. Check WhatsApp Manager.',
};

/**
 * A Graph API failure with Meta's diagnosis attached.
 *
 * axios's own message is "Request failed with status code 400", which is what reached the Slack
 * alert and the message row before — useless for telling an expired token from a tester missing off
 * the allowed list. `response.status` is kept in axios's shape because the inbound service's retry
 * rule reads it there to tell a terminal 4xx from a transient failure.
 */
export class MetaGraphError extends Error {
  readonly response?: { status: number };
  readonly code?: number;

  constructor(action: string, error: unknown) {
    const res = (
      error as {
        response?: {
          status?: number;
          data?: { error?: { message?: string; code?: number } };
        };
        message?: string;
      }
    )?.response;
    const meta = res?.data?.error;
    const code = typeof meta?.code === 'number' ? meta.code : undefined;
    const hint = code !== undefined ? META_ERROR_HINTS[code] : undefined;
    // Meta echoes a malformed token back in its message ("Malformed access token EAAB…"), and this
    // text goes to Slack, the message row and the admin screen. A truncated paste of a real token
    // is exactly the malformed case, so the echo is redacted rather than trusted to be junk.
    const detail = (
      meta?.message ??
      (error instanceof Error ? error.message : 'unknown error')
    ).replace(/\bEAA[A-Za-z0-9_-]{4,}/g, 'EAA…[redacted]');
    super(
      `Meta rejected ${action}` +
        (res?.status ? ` (HTTP ${res.status}` : ' (') +
        (code !== undefined ? `, code ${code})` : ')') +
        `: ${detail}` +
        (hint ? ` — ${hint}` : ''),
    );
    this.name = 'MetaGraphError';
    if (typeof res?.status === 'number') this.response = { status: res.status };
    this.code = code;
  }
}

/** Phone-number fields for the connection check; the fallback is what every version has served. */
const PHONE_FIELDS =
  'display_phone_number,verified_name,quality_rating,name_status,platform_type,status';
const PHONE_FIELDS_MINIMAL = 'display_phone_number,verified_name';

/**
 * WhatsApp Business Cloud API (Meta, first-party).
 *
 * Chosen over a BSP for the first implementation on three grounds: no per-message markup on top of
 * Meta's own conversation pricing (which matters for a free helpline bot whose cost scales with its
 * success), a signature scheme that is a plain HMAC over the raw body rather than one that depends on
 * the request URL surviving a proxy, and one fewer vendor holding mental healthcare workers' phone
 * numbers and question text.
 */
@Injectable()
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta';
  private readonly logger = LoggerService.getInstance(
    MetaWhatsAppProvider.name,
  );

  constructor(private readonly config: AppConfigService) {}

  verifyWebhookChallenge(query: Record<string, unknown>): string | null {
    const mode = String(query['hub.mode'] ?? '');
    const token = String(query['hub.verify_token'] ?? '');
    const challenge = query['hub.challenge'];

    const expected = this.config.whatsapp.verifyToken;
    if (!expected) {
      this.logger.error(
        'WHATSAPP_VERIFY_TOKEN is not configured; refusing the webhook handshake',
      );
      return null;
    }
    if (mode !== 'subscribe' || !this.safeEquals(token, expected)) {
      // Logged at warn, not error: an unsuccessful handshake is usually someone probing the
      // endpoint, and it happens on a public URL.
      this.logger.warn('Rejected a WhatsApp webhook handshake');
      return null;
    }
    return challenge === undefined || challenge === null
      ? ''
      : String(challenge);
  }

  /**
   * Verify `X-Hub-Signature-256`, an HMAC-SHA256 of the RAW request body keyed by the app secret.
   *
   * Uses `req.rawBody`, captured by the express.json `verify` hook in main.ts. Re-serialising the
   * parsed body cannot work — key order and whitespace differ, so the HMAC never matches — and
   * reading the stream here yields nothing because the body parser already consumed it.
   */
  verifyRequest(req: Request): boolean {
    const appSecret = this.config.whatsapp.appSecret;
    if (!appSecret) {
      // Fail CLOSED. Accepting unsigned webhooks because a secret is missing would let anyone POST
      // arbitrary "worker questions" at the bot.
      this.logger.error(
        'WHATSAPP_APP_SECRET is not configured; rejecting the webhook',
      );
      return false;
    }

    const header = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature?.startsWith('sha256=')) return false;

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody?.length) {
      this.logger.error(
        'Webhook raw body is missing — the express.json verify hook in main.ts is not capturing it',
      );
      return false;
    }

    const expected = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    return this.safeEquals(signature.slice('sha256='.length), expected);
  }

  /**
   * Pull messages out of Meta's nested envelope.
   *
   * Shape is entry[].changes[].value.messages[]. Status callbacks (`value.statuses`) arrive through
   * the same webhook and are ignored — treating a delivery receipt as an inbound message would have
   * the bot answering itself.
   */
  parseInbound(body: unknown): InboundWhatsAppMessage[] {
    const payload = body as {
      entry?: {
        changes?: {
          value?: {
            metadata?: { phone_number_id?: string };
            messages?: {
              id?: string;
              from?: string;
              type?: string;
              timestamp?: string;
              text?: { body?: string };
              button?: { text?: string };
              interactive?: {
                button_reply?: { title?: string };
                list_reply?: { title?: string };
              };
            }[];
          };
        }[];
      }[];
    };

    const out: InboundWhatsAppMessage[] = [];
    const ownNumberId = this.config.whatsapp.phoneNumberId;

    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        // One Meta app can hold several numbers — the free test number alongside the real one is
        // the usual pair during setup — and all of them deliver to this one webhook. A reply always
        // goes out from WHATSAPP_PHONE_NUMBER_ID, so answering a message sent to a DIFFERENT number
        // would reach the worker from a number they never wrote to, where Meta refuses free-form
        // text anyway (no open 24-hour window). Skipped, not answered.
        const addressedTo = change?.value?.metadata?.phone_number_id;
        if (ownNumberId && addressedTo && addressedTo !== ownNumberId) {
          if (change?.value?.messages?.length) {
            this.logger.warn(
              `Ignoring ${change.value.messages.length} message(s) sent to phone number id ` +
                `${addressedTo}; this deployment answers for ${ownNumberId} only`,
            );
          }
          continue;
        }
        for (const message of change?.value?.messages ?? []) {
          if (!message?.id || !message?.from) continue;

          const type = message.type ?? 'text';
          // A quick-reply button or list selection is a text answer as far as the bot is concerned,
          // so its title is treated as the message body rather than as unsupported media.
          const text =
            message.text?.body ??
            message.button?.text ??
            message.interactive?.button_reply?.title ??
            message.interactive?.list_reply?.title ??
            '';

          out.push({
            providerMessageId: message.id,
            from: this.normalisePhone(message.from),
            text: text.trim(),
            isUnsupportedMedia: !text.trim() && UNSUPPORTED_TYPES.has(type),
            timestamp: message.timestamp
              ? new Date(Number(message.timestamp) * 1000)
              : new Date(),
          });
        }
      }
    }

    return out;
  }

  async sendText(
    to: string,
    body: string,
  ): Promise<{ providerMessageId: string }> {
    const { phoneNumberId, accessToken, graphApiVersion } =
      this.config.whatsapp;
    if (!phoneNumberId || !accessToken) {
      throw new Error(
        'WhatsApp sending is not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).',
      );
    }

    const url = `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`;
    let response: { data?: { messages?: { id?: string }[] } };
    try {
      response = await axios.post<{ messages?: { id?: string }[] }>(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          // preview_url off: a link preview would fetch whatever URL a citation contains and render
          // it in the worker's chat, which is neither wanted nor predictable.
          text: { body, preview_url: false },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          // Well under the inbound consumer's SQS visibility timeout: a hung send must not let the
          // message be redelivered and answered twice.
          timeout: 15_000,
        },
      );
    } catch (error) {
      throw new MetaGraphError('the send', error);
    }

    const providerMessageId = response.data?.messages?.[0]?.id;
    if (!providerMessageId) {
      throw new Error('WhatsApp accepted the send but returned no message id');
    }
    return { providerMessageId };
  }

  /**
   * Blue ticks plus a "typing…" bubble, until the reply lands or 25 seconds pass.
   *
   * Called only on the paths that are about to reply after a model call — retrieval takes several
   * seconds, and without a signal a worker at work has no way to tell a bot that is thinking from one
   * that is broken. Never on a path that stays silent (opted out, blocked, rate-limited): Meta's own
   * guidance is to show typing only when a reply is coming, and a bubble that never resolves reads as
   * being ignored.
   */
  async showTypingIndicator(providerMessageId: string): Promise<void> {
    const { phoneNumberId, accessToken } = this.config.whatsapp;
    if (!phoneNumberId || !accessToken) return;
    try {
      await this.graph(
        'post',
        `${phoneNumberId}/messages`,
        'the typing indicator',
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: providerMessageId,
          typing_indicator: { type: 'text' },
        },
        // Short: this rides ahead of the real work, and the bubble is worth nothing once the answer
        // is ready anyway.
        { timeout: 5_000 },
      );
    } catch (error) {
      this.logger.warn(
        `Typing indicator not shown: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Ask Meta whether the configured token and number actually work.
   *
   * Every "is it configured?" boolean on the settings screen can be green while the bot is still
   * dead — a 24-hour token that expired overnight, a number id from the test WABA, a number never
   * registered for the API. This is the call that tells those apart, and it reads only.
   */
  async checkConnection(): Promise<WhatsAppConnectionCheck> {
    const { phoneNumberId, accessToken, businessAccountId } =
      this.config.whatsapp;
    if (!phoneNumberId || !accessToken) {
      return {
        ok: false,
        error:
          'WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must both be set before Meta can be checked.',
        subscribedApps: null,
      };
    }

    const result: WhatsAppConnectionCheck = { ok: false, subscribedApps: null };

    try {
      let data: Record<string, string | undefined>;
      try {
        data = await this.graph(
          'get',
          phoneNumberId,
          'the phone number lookup',
          undefined,
          { params: { fields: PHONE_FIELDS } },
        );
      } catch (error) {
        // A field Meta has renamed or retired fails the whole request with #100. Retry with the two
        // fields that have always existed, so one stale field name cannot hide a working connection.
        if (error instanceof MetaGraphError && error.code === 100) {
          data = await this.graph(
            'get',
            phoneNumberId,
            'the phone number lookup',
            undefined,
            { params: { fields: PHONE_FIELDS_MINIMAL } },
          );
        } else {
          throw error;
        }
      }
      result.ok = true;
      result.phoneNumber = {
        displayPhoneNumber: data.display_phone_number,
        verifiedName: data.verified_name,
        qualityRating: data.quality_rating,
        nameStatus: data.name_status,
        platformType: data.platform_type,
        status: data.status,
      };
    } catch (error) {
      result.error =
        error instanceof Error ? error.message : 'Meta could not be reached';
    }

    if (businessAccountId) {
      try {
        const subs = await this.graph<{
          data?: {
            whatsapp_business_api_data?: { name?: string; id?: string };
          }[];
        }>(
          'get',
          `${businessAccountId}/subscribed_apps`,
          'the webhook subscription lookup',
        );
        result.subscribedApps = (subs.data ?? []).map(
          (row) =>
            row.whatsapp_business_api_data?.name ??
            row.whatsapp_business_api_data?.id ??
            'unnamed app',
        );
      } catch (error) {
        result.subscribedApps = null;
        result.subscriptionError =
          error instanceof Error ? error.message : 'unknown error';
      }
    }

    return result;
  }

  /**
   * Register the number for Cloud API use. Meta requires this once per number before it can send,
   * and the PIN it sets becomes the number's two-step-verification PIN — the admin chooses it.
   */
  async registerPhoneNumber(pin: string): Promise<void> {
    const { phoneNumberId, accessToken } = this.config.whatsapp;
    if (!phoneNumberId || !accessToken) {
      throw new Error(
        'WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must both be set first.',
      );
    }
    await this.graph('post', `${phoneNumberId}/register`, 'the registration', {
      messaging_product: 'whatsapp',
      pin,
    });
  }

  /**
   * Subscribe the token's app to the business account's webhooks. Idempotent on Meta's side.
   *
   * Without this the webhook handshake still succeeds and the dashboard looks finished, but Meta
   * never delivers a single message — the quietest way for this setup to fail.
   */
  async subscribeApp(): Promise<void> {
    const { businessAccountId, accessToken } = this.config.whatsapp;
    if (!businessAccountId || !accessToken) {
      throw new Error(
        'WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_ACCESS_TOKEN must both be set first.',
      );
    }
    await this.graph(
      'post',
      `${businessAccountId}/subscribed_apps`,
      'the webhook subscription',
    );
  }

  /** One authenticated Graph API call, with Meta's error unpacked into a MetaGraphError. */
  private async graph<T = Record<string, string | undefined>>(
    method: 'get' | 'post',
    path: string,
    action: string,
    body?: unknown,
    options: AxiosRequestConfig = {},
  ): Promise<T> {
    const { accessToken, graphApiVersion } = this.config.whatsapp;
    const url = `https://graph.facebook.com/${graphApiVersion}/${path}`;
    const config: AxiosRequestConfig = {
      timeout: 10_000,
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    };
    try {
      const response =
        method === 'get'
          ? await axios.get<T>(url, config)
          : await axios.post<T>(url, body ?? {}, config);
      return response.data;
    } catch (error) {
      throw new MetaGraphError(action, error);
    }
  }

  /** Meta sends E.164 without a '+'; normalise both directions to the bare digits. */
  private normalisePhone(from: string): string {
    return from.replace(/[^\d]/g, '');
  }

  /** Constant-time compare, so a bad signature cannot be brute-forced byte by byte. */
  private safeEquals(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
