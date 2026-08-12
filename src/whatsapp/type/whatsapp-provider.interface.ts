import { Request } from 'express';

/** One inbound message, normalised across providers. */
export interface InboundWhatsAppMessage {
  /** The provider's message id. The dedupe key — see WaMessage. */
  providerMessageId: string;
  /** Sender in E.164, without the leading '+'. Normalised by the provider adapter. */
  from: string;
  /** Message text. Empty for media, which the pipeline answers with an explanation. */
  text: string;
  /** True when the message was an image, audio note, document or location. */
  isUnsupportedMedia: boolean;
  /** Provider timestamp when supplied, else receipt time. */
  timestamp: Date;
}

/**
 * The seam between the pipeline and whichever WhatsApp provider is in use.
 *
 * Exists because the provider is the single most likely thing to change: a BSP contract, a move
 * from a Twilio sandbox to a real Meta number, or a regional requirement all replace this and
 * nothing else. Everything on the far side of it — dedupe, consent, rate limiting, templates,
 * retrieval — is provider-agnostic and must stay that way.
 *
 * `verifyRequest` takes the WHOLE request rather than (rawBody, signature) deliberately. Meta signs
 * the raw body alone, but Twilio's signature covers the full request URL plus sorted POST params, so
 * a narrower signature would make a Twilio adapter impossible without changing this interface.
 */
export interface WhatsAppProvider {
  readonly name: string;

  /**
   * Answer the provider's webhook-registration handshake.
   *
   * Meta performs a GET with hub.mode/hub.verify_token/hub.challenge and expects the challenge
   * echoed back. Returns null when the query is not a valid handshake (so the caller 403s) and for
   * providers that have no such step.
   */
  verifyWebhookChallenge(query: Record<string, unknown>): string | null;

  /** Verify the request actually came from the provider. This IS the webhook's authentication. */
  verifyRequest(req: Request): boolean;

  /**
   * Parse a webhook payload into zero or more messages.
   *
   * Always an array: Meta batches several events into one POST, and a payload can legitimately
   * contain none we care about (delivery receipts, read receipts, status updates).
   */
  parseInbound(body: unknown): InboundWhatsAppMessage[];

  /** Send a plain-text reply. Resolves with the provider's id for the sent message. */
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>;
}

/** DI token. Bound to the implementation named by the `whatsapp_bot` settings row. */
export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';
