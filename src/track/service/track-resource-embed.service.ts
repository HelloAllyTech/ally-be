import { createHash } from 'crypto';
import { lookup as dnsLookup } from 'dns';
import { BlockList, isIP } from 'net';
import { Injectable } from '@nestjs/common';
import axios, { AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { ArticleContent, TrackItemType } from '../type/track.type';
import { TrackEnrollmentService } from './track-enrollment.service';

const PROBE_TIMEOUT_MS = 5000;
const PROBE_MAX_REDIRECTS = 5;
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const CACHE_KEY_PREFIX = 'track:resource-embed:v1';

/**
 * Loopback, private, link-local (cloud metadata), CGNAT and unspecified
 * ranges. The probe fetches trainer-supplied URLs from inside our network,
 * so without this a resource pointed at an internal address would turn the
 * endpoint into a (blind) internal port scanner.
 */
const BLOCKED_ADDRESSES = new BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
].forEach(([net, prefix]) =>
  BLOCKED_ADDRESSES.addSubnet(net as string, prefix as number, 'ipv4'),
);
BLOCKED_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_ADDRESSES.addAddress('::1', 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return BLOCKED_ADDRESSES.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 4) return BLOCKED_ADDRESSES.check(address, 'ipv4');
  if (family === 6) return BLOCKED_ADDRESSES.check(address, 'ipv6');
  return true;
}

/**
 * Resolves through the system resolver but refuses any blocked address. Used
 * as the request's own `lookup`, so the address checked is the address
 * connected to — no gap for a DNS answer to change in between.
 */
function guardedLookup(
  hostname: string,
  options: object,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) {
  dnsLookup(hostname, { ...options, all: false }, (err, address, family) => {
    if (err) return callback(err, '', 0);
    if (isBlockedAddress(address)) {
      return callback(
        new Error(`Refusing to probe internal address for ${hostname}`),
        '',
        0,
      );
    }
    callback(null, address, family);
  });
}

type Headers = RawAxiosResponseHeaders | AxiosResponseHeaders;

/**
 * Whether a final response means the page will not render inside our
 * iframe/WebView. Errs towards "no": a false "no" only means the link opens
 * in a new tab, which always works, while a false "yes" leaves the learner
 * staring at an error or a bot-check page inside the course.
 */
export function responseBlocksEmbedding(
  status: number,
  headers: Headers,
): boolean {
  // 4xx/5xx — including the 403 a bot-protected site (e.g. ResearchGate)
  // answers with, the same response the learner's embed got.
  if (status >= 400) return true;

  const frameOptions = String(headers['x-frame-options'] ?? '').toLowerCase();
  if (frameOptions.includes('deny') || frameOptions.includes('sameorigin')) {
    return true;
  }

  const csp = String(headers['content-security-policy'] ?? '').toLowerCase();
  const frameAncestors = csp
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('frame-ancestors'));
  if (frameAncestors) {
    const sources = frameAncestors.split(/\s+/).slice(1);
    if (!sources.includes('*') && !sources.includes('https:')) return true;
  }

  return false;
}

/**
 * Decides, per article resource, whether the player should skip the
 * embedded view and open the link in a new tab/the system browser.
 *
 * The browser cannot tell the player this itself: a cross-origin iframe that
 * receives a 403 or a bot-check page still fires `onLoad`, and its content
 * and status are unreadable from the parent page. So the backend requests the
 * URL once, reads the status and framing headers, and caches the answer.
 * Any failure — timeout, DNS error, refused address, too many redirects —
 * also means "open externally".
 */
@Injectable()
export class TrackResourceEmbedService {
  private readonly logger = LoggerService.getInstance(
    TrackResourceEmbedService.name,
  );

  constructor(
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly redisService: RedisService,
  ) {}

  async getResourceEmbeddability(trackItemId: string): Promise<{
    resources: { id: string; openExternally: boolean }[];
  }> {
    const { item } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.ARTICLE) return { resources: [] };

    const resources = (item.content as ArticleContent).resources ?? [];
    const results = await Promise.all(
      resources.map(async (resource) => ({
        id: resource.id,
        openExternally: await this.shouldOpenExternally(resource.url),
      })),
    );
    return { resources: results };
  }

  async shouldOpenExternally(url: string): Promise<boolean> {
    const cacheKey = `${CACHE_KEY_PREFIX}:${createHash('sha256').update(url).digest('hex')}`;
    const cached = await this.redisService.get(cacheKey).catch(() => null);
    if (cached === '1') return true;
    if (cached === '0') return false;

    const openExternally = await this.probe(url);
    await this.redisService
      .set(cacheKey, openExternally ? '1' : '0', CACHE_TTL_SECONDS)
      .catch(() => undefined);
    return openExternally;
  }

  private async probe(url: string): Promise<boolean> {
    let current = url;
    try {
      for (let hop = 0; hop <= PROBE_MAX_REDIRECTS; hop++) {
        const parsed = new URL(current);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return true;
        }
        const host = parsed.hostname.replace(/^\[|\]$/g, '');
        if (isIP(host) && isBlockedAddress(host)) return true;

        const response = await axios.get(current, {
          maxRedirects: 0,
          timeout: PROBE_TIMEOUT_MS,
          responseType: 'stream',
          validateStatus: () => true,
          lookup: guardedLookup as any,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AllyResourceCheck/1.0)',
            Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          },
        });
        // Only the status and headers matter — never read the body.
        response.data?.destroy?.();

        const location = response.headers['location'];
        if (response.status >= 300 && response.status < 400 && location) {
          current = new URL(String(location), current).toString();
          continue;
        }
        return responseBlocksEmbedding(response.status, response.headers);
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Resource embed probe failed, opening externally: ${(error as Error).message}`,
      );
      return true;
    }
  }
}
