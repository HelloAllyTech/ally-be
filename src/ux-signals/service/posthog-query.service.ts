import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';

/** A HogQL result as PostHog returns it: named columns plus positional rows. */
export interface HogQlResult {
  columns: string[];
  results: unknown[][];
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Read-only HogQL access to the self-hosted PostHog.
 *
 * The platform's PostHog integration is otherwise write-only — the frontends
 * capture events and nothing has ever read them back. This is the only reader,
 * and it is deliberately the narrowest thing that works: one method, one
 * endpoint, no event-ingestion surface. Nothing here can write to PostHog, so a
 * bug in a detector query cannot corrupt the telemetry it reads.
 *
 * Auth is a *personal API key* with read scope, which is a different credential
 * from the frontends' public project key. It is server-only and must never be
 * handed to a client.
 */
@Injectable()
export class PosthogQueryService {
  private readonly logger = LoggerService.getInstance(PosthogQueryService.name);

  constructor(private readonly configService: AppConfigService) {}

  /** Whether a query credential is configured at all. Callers skip rather than fail. */
  get enabled(): boolean {
    return this.configService.posthog.enabled;
  }

  /**
   * Run one HogQL query.
   *
   * Retries once on a 5xx or a network error, because the self-hosted deployment
   * restarts for its own reasons and a scan that dies on a single blip would wait
   * a whole day for the next tick. A 4xx is never retried: a malformed query or a
   * rejected credential will be just as malformed the second time.
   */
  async query(hogql: string): Promise<HogQlResult> {
    const { host, personalApiKey, projectId, enabled } =
      this.configService.posthog;
    if (!enabled) {
      throw new ServiceUnavailableException(
        'PostHog query access is not configured (POSTHOG_HOST / POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID).',
      );
    }

    const url = `${host!.replace(/\/$/, '')}/api/projects/${projectId}/query`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await this.post(url, personalApiKey!, hogql);
        if (response.ok) {
          const body = (await response.json()) as Partial<HogQlResult>;
          return {
            columns: body.columns ?? [],
            results: body.results ?? [],
          };
        }

        const detail = (await response.text()).slice(0, 500);
        // 4xx is a us problem, not a them problem — fail immediately and loudly.
        if (response.status < 500) {
          throw new ServiceUnavailableException(
            `PostHog rejected the query (${response.status}): ${detail}`,
          );
        }
        lastError = new Error(`PostHog ${response.status}: ${detail}`);
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        lastError = error;
      }

      if (attempt === 1) {
        this.logger.warn(
          `[UX-SIGNALS] PostHog query failed, retrying once: ${String(lastError)}`,
        );
      }
    }

    throw new ServiceUnavailableException(
      `PostHog query failed after a retry: ${String(lastError)}`,
    );
  }

  /**
   * Split out so the timeout lives in one place and the retry loop above stays
   * readable. AbortSignal.timeout rather than a socket default: an unbounded hang
   * inside a scheduled task is indistinguishable from a task that never ran.
   */
  private async post(
    url: string,
    apiKey: string,
    hogql: string,
  ): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}
