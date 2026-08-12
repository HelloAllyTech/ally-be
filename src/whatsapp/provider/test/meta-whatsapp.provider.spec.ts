import { createHmac } from 'crypto';
import { Request } from 'express';
import { MetaWhatsAppProvider } from '../meta-whatsapp.provider';

/**
 * The webhook's signature check IS its authentication — there is no guard on that route — so these
 * tests are the only thing standing between the bot and anyone POSTing arbitrary "worker questions"
 * at it.
 */
describe('MetaWhatsAppProvider', () => {
  const APP_SECRET = 'test-app-secret';
  const VERIFY_TOKEN = 'test-verify-token';

  const config = {
    whatsapp: {
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      phoneNumberId: '123',
      accessToken: 'token',
      graphApiVersion: 'v21.0',
      environment: undefined,
    },
  };

  const provider = new MetaWhatsAppProvider(config as never);

  const signedRequest = (body: unknown, secret = APP_SECRET): Request => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    return {
      headers: { 'x-hub-signature-256': `sha256=${signature}` },
      rawBody: raw,
      body,
    } as unknown as Request;
  };

  describe('verifyWebhookChallenge', () => {
    it('echoes the challenge for a correct token', () => {
      expect(
        provider.verifyWebhookChallenge({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1234',
        }),
      ).toBe('1234');
    });

    it('rejects a wrong token', () => {
      expect(
        provider.verifyWebhookChallenge({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': '1234',
        }),
      ).toBeNull();
    });

    it('rejects a wrong mode', () => {
      expect(
        provider.verifyWebhookChallenge({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1234',
        }),
      ).toBeNull();
    });

    it('rejects when no verify token is configured', () => {
      const unconfigured = new MetaWhatsAppProvider({
        whatsapp: { ...config.whatsapp, verifyToken: undefined },
      } as never);

      expect(
        unconfigured.verifyWebhookChallenge({
          'hub.mode': 'subscribe',
          'hub.verify_token': '',
          'hub.challenge': '1234',
        }),
      ).toBeNull();
    });
  });

  describe('verifyRequest', () => {
    it('accepts a correctly signed body', () => {
      expect(provider.verifyRequest(signedRequest({ hello: 'world' }))).toBe(
        true,
      );
    });

    it('rejects a body signed with the wrong secret', () => {
      expect(
        provider.verifyRequest(signedRequest({ hello: 'world' }, 'other')),
      ).toBe(false);
    });

    it('rejects a tampered body', () => {
      const req = signedRequest({ hello: 'world' });
      // Same signature, different bytes — the exact attack the HMAC exists to stop.
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(
        JSON.stringify({ hello: 'tampered' }),
      );
      expect(provider.verifyRequest(req)).toBe(false);
    });

    it('rejects a missing signature header', () => {
      expect(
        provider.verifyRequest({
          headers: {},
          rawBody: Buffer.from('{}'),
        } as unknown as Request),
      ).toBe(false);
    });

    it('rejects a signature without the sha256= prefix', () => {
      expect(
        provider.verifyRequest({
          headers: { 'x-hub-signature-256': 'deadbeef' },
          rawBody: Buffer.from('{}'),
        } as unknown as Request),
      ).toBe(false);
    });

    it('rejects when rawBody was not captured', () => {
      // Guards the coupling to the express.json `verify` hook in main.ts. If that hook is ever
      // removed, every webhook must fail closed rather than be accepted unverified.
      const req = signedRequest({ hello: 'world' });
      delete (req as Request & { rawBody?: Buffer }).rawBody;
      expect(provider.verifyRequest(req)).toBe(false);
    });

    it('FAILS CLOSED when no app secret is configured', () => {
      // Accepting unsigned webhooks because a secret is missing would let anyone inject messages.
      const unconfigured = new MetaWhatsAppProvider({
        whatsapp: { ...config.whatsapp, appSecret: undefined },
      } as never);
      expect(unconfigured.verifyRequest(signedRequest({ a: 1 }))).toBe(false);
    });
  });

  describe('parseInbound', () => {
    const envelope = (messages: unknown[]) => ({
      entry: [{ changes: [{ value: { messages } }] }],
    });

    it('extracts a text message', () => {
      const parsed = provider.parseInbound(
        envelope([
          {
            id: 'wamid.1',
            from: '919812345678',
            type: 'text',
            timestamp: '1700000000',
            text: { body: '  How do I ask about intent?  ' },
          },
        ]),
      );

      expect(parsed).toHaveLength(1);
      expect(parsed[0].providerMessageId).toBe('wamid.1');
      expect(parsed[0].from).toBe('919812345678');
      expect(parsed[0].text).toBe('How do I ask about intent?');
      expect(parsed[0].isUnsupportedMedia).toBe(false);
    });

    it('flags media with no text as unsupported', () => {
      const parsed = provider.parseInbound(
        envelope([{ id: 'wamid.2', from: '91', type: 'image' }]),
      );
      expect(parsed[0].isUnsupportedMedia).toBe(true);
    });

    it('treats a quick-reply button as text, not media', () => {
      // A button tap is an answer, so its title is the message body. Treating it as unsupported
      // media would tell a worker who used the bot's own UI that it cannot read their message.
      const parsed = provider.parseInbound(
        envelope([
          {
            id: 'wamid.3',
            from: '91',
            type: 'interactive',
            interactive: { button_reply: { title: 'Yes' } },
          },
        ]),
      );
      expect(parsed[0].text).toBe('Yes');
      expect(parsed[0].isUnsupportedMedia).toBe(false);
    });

    it('ignores status callbacks', () => {
      // Delivery and read receipts arrive through the same webhook. Treating one as inbound would
      // have the bot answering itself.
      expect(
        provider.parseInbound({
          entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }],
        }),
      ).toEqual([]);
    });

    it('returns every message in a batched payload', () => {
      // Meta batches events, so a parser that returned only the first would silently drop questions.
      const parsed = provider.parseInbound({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'a',
                      from: '91',
                      type: 'text',
                      text: { body: 'one' },
                    },
                    {
                      id: 'b',
                      from: '92',
                      type: 'text',
                      text: { body: 'two' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(parsed.map((m) => m.providerMessageId)).toEqual(['a', 'b']);
    });

    it('skips messages missing an id or sender', () => {
      const parsed = provider.parseInbound(
        envelope([
          { from: '91', type: 'text', text: { body: 'no id' } },
          { id: 'wamid.4', type: 'text', text: { body: 'no sender' } },
        ]),
      );
      expect(parsed).toEqual([]);
    });

    it('tolerates an empty or malformed envelope', () => {
      expect(provider.parseInbound({})).toEqual([]);
      expect(provider.parseInbound(null)).toEqual([]);
      expect(provider.parseInbound({ entry: [{}] })).toEqual([]);
    });

    it('strips non-digits from the sender', () => {
      const parsed = provider.parseInbound(
        envelope([
          {
            id: 'x',
            from: '+91 98123-45678',
            type: 'text',
            text: { body: 'q' },
          },
        ]),
      );
      expect(parsed[0].from).toBe('919812345678');
    });
  });
});
