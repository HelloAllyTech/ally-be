import axios from 'axios';
import {
  isBlockedAddress,
  responseBlocksEmbedding,
  TrackResourceEmbedService,
} from '../track-resource-embed.service';
import { TrackItemType } from '../../type/track.type';

jest.mock('axios');
jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

const mockedGet = axios.get as jest.Mock;

const response = (status: number, headers: Record<string, string> = {}) => ({
  status,
  headers,
  data: { destroy: jest.fn() },
});

describe('responseBlocksEmbedding', () => {
  it('opens externally on any 4xx/5xx, e.g. a bot-check 403', () => {
    expect(responseBlocksEmbedding(403, {})).toBe(true);
    expect(responseBlocksEmbedding(404, {})).toBe(true);
    expect(responseBlocksEmbedding(503, {})).toBe(true);
  });

  it('opens externally when X-Frame-Options forbids framing', () => {
    expect(responseBlocksEmbedding(200, { 'x-frame-options': 'DENY' })).toBe(
      true,
    );
    expect(
      responseBlocksEmbedding(200, { 'x-frame-options': 'SAMEORIGIN' }),
    ).toBe(true);
  });

  it('opens externally when CSP frame-ancestors does not allow everyone', () => {
    expect(
      responseBlocksEmbedding(200, {
        'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
      }),
    ).toBe(true);
    expect(
      responseBlocksEmbedding(200, {
        'content-security-policy': 'frame-ancestors *',
      }),
    ).toBe(false);
  });

  it('embeds a plain 200 with no framing restrictions', () => {
    expect(responseBlocksEmbedding(200, {})).toBe(false);
  });
});

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    '::ffff:10.0.0.1',
    'fd00::1',
  ])('refuses internal address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it('allows a public address', () => {
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
  });
});

describe('TrackResourceEmbedService', () => {
  const cache = new Map<string, string>();
  const redisService = {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      cache.set(key, value);
    }),
  };
  const trackEnrollmentService = { getPermittedItemProgress: jest.fn() };
  const service = new TrackResourceEmbedService(
    trackEnrollmentService as any,
    redisService as any,
  );

  beforeEach(() => {
    cache.clear();
    jest.clearAllMocks();
  });

  it('flags each resource of the permitted article', async () => {
    trackEnrollmentService.getPermittedItemProgress.mockResolvedValue({
      item: {
        type: TrackItemType.ARTICLE,
        content: {
          html: '',
          resources: [
            { id: 'rg', title: 'Book', url: 'https://www.researchgate.net/x' },
            { id: 'ok', title: 'Page', url: 'https://example.com/' },
          ],
        },
      },
    });
    mockedGet.mockImplementation(async (url: string) =>
      url.includes('researchgate') ? response(403) : response(200),
    );

    await expect(service.getResourceEmbeddability('item-1')).resolves.toEqual({
      resources: [
        { id: 'rg', openExternally: true },
        { id: 'ok', openExternally: false },
      ],
    });
  });

  it('returns nothing for a non-article item', async () => {
    trackEnrollmentService.getPermittedItemProgress.mockResolvedValue({
      item: { type: TrackItemType.VIDEO, content: {} },
    });
    await expect(service.getResourceEmbeddability('item-1')).resolves.toEqual({
      resources: [],
    });
  });

  it('opens externally when the request fails', async () => {
    mockedGet.mockRejectedValue(new Error('timeout of 5000ms exceeded'));
    await expect(
      service.shouldOpenExternally('https://slow.example/'),
    ).resolves.toBe(true);
  });

  it('follows redirects and judges the final response', async () => {
    mockedGet
      .mockResolvedValueOnce(response(301, { location: '/final' }))
      .mockResolvedValueOnce(response(200, { 'x-frame-options': 'DENY' }));
    await expect(
      service.shouldOpenExternally('https://site.example/start'),
    ).resolves.toBe(true);
    expect(mockedGet).toHaveBeenLastCalledWith(
      'https://site.example/final',
      expect.anything(),
    );
  });

  it('never requests a literal internal address', async () => {
    await expect(
      service.shouldOpenExternally('http://169.254.169.254/latest/meta-data'),
    ).resolves.toBe(true);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('re-checks a redirect target against the internal-address guard', async () => {
    mockedGet.mockResolvedValueOnce(
      response(302, { location: 'http://127.0.0.1:6379/' }),
    );
    await expect(
      service.shouldOpenExternally('https://site.example/'),
    ).resolves.toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('caches the answer per URL', async () => {
    mockedGet.mockResolvedValue(response(200));
    await service.shouldOpenExternally('https://example.com/');
    await service.shouldOpenExternally('https://example.com/');
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('still answers when Redis is down', async () => {
    redisService.get.mockRejectedValueOnce(new Error('down'));
    redisService.set.mockRejectedValueOnce(new Error('down'));
    mockedGet.mockResolvedValue(response(403));
    await expect(
      service.shouldOpenExternally('https://example.com/'),
    ).resolves.toBe(true);
  });
});
