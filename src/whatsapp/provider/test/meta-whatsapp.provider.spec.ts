import { createHmac } from 'crypto';
import axios from 'axios';
import { Request } from 'express';
import {
  MetaGraphError,
  MetaWhatsAppProvider,
} from '../meta-whatsapp.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** The shape axios rejects with when Meta answers 4xx/5xx. */
const metaFailure = (status: number, code: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error: { message, code } } },
  });

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
      graphApiVersion: 'v25.0',
      businessAccountId: 'waba-1',
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

  describe('parseInbound — which number was written to', () => {
    const toNumber = (phoneNumberId: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneNumberId },
                messages: [
                  { id: 'm', from: '91', type: 'text', text: { body: 'q' } },
                ],
              },
            },
          ],
        },
      ],
    });

    it('answers messages sent to the configured number', () => {
      expect(provider.parseInbound(toNumber('123'))).toHaveLength(1);
    });

    it('skips messages sent to another number on the same Meta app', () => {
      // The test number and the real number share one webhook during setup. A reply always goes
      // out from the configured number, so answering the other one's traffic would reach the
      // worker from a number they never wrote to.
      expect(provider.parseInbound(toNumber('999'))).toEqual([]);
    });
  });

  describe('sendText errors', () => {
    afterEach(() => jest.resetAllMocks());

    it("carries Meta's code, message and a fix into the error", async () => {
      mockedAxios.post.mockRejectedValueOnce(
        metaFailure(400, 131030, 'Recipient phone number not in allowed list'),
      );

      const error = await provider.sendText('91', 'hi').catch((e) => e);

      expect(error).toBeInstanceOf(MetaGraphError);
      expect(error.message).toContain('code 131030');
      expect(error.message).toContain(
        'Recipient phone number not in allowed list',
      );
      expect(error.message).toContain('API Setup');
      expect(error.code).toBe(131030);
    });

    it('keeps response.status where the retry rule reads it', async () => {
      // WhatsAppInboundService treats a 4xx as terminal by reading error.response.status. Losing
      // it would turn every rejected send into a retry.
      mockedAxios.post.mockRejectedValueOnce(
        metaFailure(401, 190, 'Error validating access token'),
      );
      const error = await provider.sendText('91', 'hi').catch((e) => e);
      expect(error.response).toEqual({ status: 401 });
    });

    it('has no status when Meta never answered', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('socket hang up'));
      const error = await provider.sendText('91', 'hi').catch((e) => e);
      expect(error.response).toBeUndefined();
      expect(error.message).toContain('socket hang up');
    });
  });

  describe('showTypingIndicator', () => {
    afterEach(() => jest.resetAllMocks());

    it('marks the message read with a typing bubble', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { success: true } });
      await provider.showTypingIndicator('wamid.9');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/123/messages',
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: 'wamid.9',
          typing_indicator: { type: 'text' },
        },
        expect.objectContaining({ timeout: 5_000 }),
      );
    });

    it('never throws — a missing bubble must not cost the worker their answer', async () => {
      mockedAxios.post.mockRejectedValueOnce(metaFailure(500, 1, 'boom'));
      await expect(
        provider.showTypingIndicator('wamid.9'),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkConnection', () => {
    afterEach(() => jest.resetAllMocks());

    it('reports the number and the webhook subscription', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            display_phone_number: '+91 98000 00000',
            verified_name: 'Ally',
            quality_rating: 'GREEN',
            platform_type: 'CLOUD_API',
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{ whatsapp_business_api_data: { name: 'Ally Bot' } }],
          },
        });

      const result = await provider.checkConnection();

      expect(result.ok).toBe(true);
      expect(result.phoneNumber?.displayPhoneNumber).toBe('+91 98000 00000');
      expect(result.phoneNumber?.platformType).toBe('CLOUD_API');
      expect(result.subscribedApps).toEqual(['Ally Bot']);
    });

    it('falls back to the minimal fields when Meta rejects a field name', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(
          metaFailure(400, 100, 'Tried accessing nonexisting field (status)'),
        )
        .mockResolvedValueOnce({
          data: { display_phone_number: '+91 1', verified_name: 'Ally' },
        })
        .mockResolvedValueOnce({ data: { data: [] } });

      const result = await provider.checkConnection();

      expect(result.ok).toBe(true);
      expect(result.phoneNumber?.verifiedName).toBe('Ally');
      expect(result.subscribedApps).toEqual([]);
    });

    it('explains an expired token', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(metaFailure(401, 190, 'Session has expired'))
        .mockRejectedValueOnce(metaFailure(401, 190, 'Session has expired'));

      const result = await provider.checkConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('System User token');
    });

    it('does not report "not subscribed" when there is no business account id to check', async () => {
      const noWaba = new MetaWhatsAppProvider({
        whatsapp: { ...config.whatsapp, businessAccountId: undefined },
      } as never);
      mockedAxios.get.mockResolvedValueOnce({
        data: { display_phone_number: '+91 1' },
      });

      const result = await noWaba.checkConnection();

      expect(result.subscribedApps).toBeNull();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('refuses to call Meta without a token and number id', async () => {
      const bare = new MetaWhatsAppProvider({
        whatsapp: { ...config.whatsapp, accessToken: undefined },
      } as never);
      const result = await bare.checkConnection();
      expect(result.ok).toBe(false);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });
});
