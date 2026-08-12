import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { Request } from 'express';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  InboundWhatsAppMessage,
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

    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
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
    const response = await axios.post<{ messages?: { id?: string }[] }>(
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

    const providerMessageId = response.data?.messages?.[0]?.id;
    if (!providerMessageId) {
      throw new Error('WhatsApp accepted the send but returned no message id');
    }
    return { providerMessageId };
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
