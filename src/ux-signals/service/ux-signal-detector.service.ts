import { Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';

import {
  UX_SIGNAL_FUNNELS,
  UX_SIGNAL_LIMITS,
  UX_SIGNAL_TERMINAL_ROUTES,
  UX_SIGNAL_THRESHOLDS,
  UX_SIGNAL_WINDOW_DAYS,
} from '../constants/ux-signals.constants';
import { UxSignalDetector, UxSignalKind } from '../enum/ux-signal.enum';
import { UxSignal } from '../ux-signals.types';
import { HogQlResult, PosthogQueryService } from './posthog-query.service';

/** What one detector pass produced, plus the detectors that could not run. */
export interface DetectionResult {
  signals: UxSignal[];
  failedDetectors: string[];
  /** How many detectors were attempted, so a caller can tell "all failed" from "some did". */
  totalDetectors: number;
}

/**
 * Turns PostHog telemetry into threshold-crossing signals.
 *
 * Every detector is deterministic SQL plus a numeric threshold — no model is
 * involved at this stage, on purpose. The LLM's job later is to *explain and
 * cluster* signals, and it can only do that honestly if the question "did this
 * cross the line?" was already settled by arithmetic. Letting a model decide what
 * counts as a problem would make the same telemetry produce different findings on
 * different nights.
 *
 * Each detector is independently fallible: one bad query (an event PostHog has
 * never seen, a function the self-hosted version lacks) degrades that detector to
 * a named entry in `failedDetectors` and leaves the rest of the scan intact. A
 * scan that reports "5 signals, rage_click_cluster failed" is far more useful than
 * one that reports nothing because a single query was unsupported.
 *
 * ## PII
 * Detectors select event properties and aggregates only. PostHog persons carry
 * email and name (the frontends pass them to `identify`), so person properties
 * are never selected — `person_id` is used solely inside `uniq()` to count
 * breadth. Free-text event properties that could carry user content are scrubbed
 * before they leave this service; see scrubExample.
 */
@Injectable()
export class UxSignalDetectorService {
  private readonly logger = LoggerService.getInstance(
    UxSignalDetectorService.name,
  );

  constructor(private readonly posthog: PosthogQueryService) {}

  /**
   * Run every detector for the window.
   *
   * Detectors run sequentially rather than in parallel: the self-hosted PostHog
   * is a shared hobby-tier deployment, and seven concurrent aggregate scans over
   * a week of events is exactly the kind of load that makes it fall over for the
   * people using its dashboards.
   */
  async detect(windowFrom: string, windowTo: string): Promise<DetectionResult> {
    const window = { from: windowFrom, to: windowTo };
    const signals: UxSignal[] = [];
    const failedDetectors: string[] = [];

    const detectors: Array<[UxSignalDetector, () => Promise<UxSignal[]>]> = [
      [UxSignalDetector.API_ERROR_SPIKE, () => this.apiErrorSpikes(window)],
      [UxSignalDetector.ERROR_LOOP, () => this.errorLoops(window)],
      [UxSignalDetector.RAGE_CLICK_CLUSTER, () => this.rageClicks(window)],
      [UxSignalDetector.DEAD_CLICK_CLUSTER, () => this.deadClicks(window)],
      [UxSignalDetector.ROUTE_ABANDONMENT, () => this.routeAbandonment(window)],
      [
        UxSignalDetector.ZERO_RESULT_SEARCH,
        () => this.zeroResultSearch(window),
      ],
      [UxSignalDetector.FUNNEL_DROPOFF, () => this.funnelDropoffs(window)],
    ];

    for (const [name, run] of detectors) {
      try {
        signals.push(...(await run()));
      } catch (error) {
        failedDetectors.push(name);
        this.logger.warn(
          `[UX-SIGNALS] Detector ${name} failed: ${String(error)}`,
        );
      }
    }

    // Widest blast radius first, so if the cap bites it drops the narrowest
    // signals rather than an arbitrary slice.
    signals.sort((a, b) => b.sessions - a.sessions);
    return {
      signals: signals.slice(0, UX_SIGNAL_LIMITS.MAX_SIGNALS_PER_SCAN),
      failedDetectors,
      totalDetectors: detectors.length,
    };
  }

  // ── detectors ──────────────────────────────────────────────────────────────

  /**
   * Endpoints erroring far above their own trailing rate.
   *
   * Compared against each endpoint's own baseline rather than a platform-wide
   * number: a chatty endpoint with a steady 1% error rate is not news, while a
   * quiet one that suddenly fails is. An endpoint with no prior errors has no
   * baseline to multiply, so it gets an absolute floor instead.
   */
  private async apiErrorSpikes(window: {
    from: string;
    to: string;
  }): Promise<UxSignal[]> {
    const t = UX_SIGNAL_THRESHOLDS[UxSignalDetector.API_ERROR_SPIKE];
    const rows = this.rows(
      await this.posthog.query(`
        SELECT
          toString(properties.endpoint) AS endpoint,
          countIf(timestamp >= now() - INTERVAL 1 DAY) AS recent,
          count() AS total,
          uniqIf(properties.$session_id, timestamp >= now() - INTERVAL 1 DAY) AS sessions,
          uniqIf(person_id, timestamp >= now() - INTERVAL 1 DAY) AS users,
          groupUniqArray(10)(toString(properties.error_code)) AS codes,
          any(toString(properties.page_path)) AS route
        FROM events
        WHERE event = 'api_error_occurred'
          AND timestamp >= now() - INTERVAL ${UX_SIGNAL_WINDOW_DAYS + 1} DAY
        GROUP BY endpoint
        ORDER BY recent DESC
        LIMIT 50
      `),
    );

    const signals: UxSignal[] = [];
    for (const row of rows) {
      const recent = this.num(row.recent);
      const total = this.num(row.total);
      const sessions = this.num(row.sessions);
      const priorDailyMean = (total - recent) / UX_SIGNAL_WINDOW_DAYS;

      const crossed =
        priorDailyMean > 0
          ? recent >= t.MIN_EVENTS &&
            recent >= priorDailyMean * t.BASELINE_MULTIPLE
          : recent >= t.MIN_EVENTS_NO_BASELINE;
      if (!crossed || sessions < t.MIN_SESSIONS) continue;

      const endpoint = this.text(row.endpoint) || 'unknown endpoint';
      signals.push({
        detector: UxSignalDetector.API_ERROR_SPIKE,
        defaultKind: UxSignalKind.BUG,
        route: this.routeOf(row.route) || endpoint,
        target: endpoint,
        metric: {
          name: 'api errors in the last 24h',
          value: recent,
          baseline: Number(priorDailyMean.toFixed(2)),
          threshold:
            priorDailyMean > 0
              ? Number((priorDailyMean * t.BASELINE_MULTIPLE).toFixed(2))
              : t.MIN_EVENTS_NO_BASELINE,
        },
        window,
        sessions,
        users: this.num(row.users),
        examples: this.examples(
          this.list(row.codes).map((code) => `error code ${code}`),
        ),
      });
    }
    return signals;
  }

  /**
   * Sessions hitting the same endpoint error over and over in minutes — someone
   * retrying something that cannot succeed.
   *
   * Distinct from a spike: a spike is many users hitting a wall once, a loop is
   * one user hitting it repeatedly, which is the stronger signal that the UI
   * offers no way forward. Both can be true of the same endpoint, and triage is
   * told to merge them when they are.
   */
  private async errorLoops(window: {
    from: string;
    to: string;
  }): Promise<UxSignal[]> {
    const t = UX_SIGNAL_THRESHOLDS[UxSignalDetector.ERROR_LOOP];
    const rows = this.rows(
      await this.posthog.query(`
        SELECT
          endpoint,
          count() AS loop_sessions,
          uniq(person) AS users,
          max(hits) AS worst_run,
          any(route) AS route
        FROM (
          SELECT
            toString(properties.endpoint) AS endpoint,
            properties.$session_id AS sess,
            person_id AS person,
            any(toString(properties.page_path)) AS route,
            count() AS hits,
            dateDiff('minute', min(timestamp), max(timestamp)) AS span
          FROM events
          WHERE event = 'api_error_occurred'
            AND timestamp >= now() - INTERVAL ${UX_SIGNAL_WINDOW_DAYS} DAY
          GROUP BY endpoint, sess, person
          HAVING hits >= ${t.MIN_REPEATS_IN_SESSION} AND span <= ${t.WITHIN_MINUTES}
        )
        GROUP BY endpoint
        ORDER BY loop_sessions DESC
        LIMIT 25
      `),
    );

    return rows
      .filter((row) => this.num(row.loop_sessions) >= t.MIN_SESSIONS)
      .map((row) => {
        const endpoint = this.text(row.endpoint) || 'unknown endpoint';
        return {
          detector: UxSignalDetector.ERROR_LOOP,
          defaultKind: UxSignalKind.BUG,
          route: this.routeOf(row.route) || endpoint,
          target: endpoint,
          metric: {
            name: `sessions retrying the same failing call within ${t.WITHIN_MINUTES} minutes`,
            value: this.num(row.loop_sessions),
            threshold: t.MIN_SESSIONS,
          },
          window,
          sessions: this.num(row.loop_sessions),
          users: this.num(row.users),
          examples: this.examples([
            `worst session hit this endpoint ${this.num(row.worst_run)} times in under ${t.WITHIN_MINUTES} minutes`,
          ]),
        };
      });
  }

  /** PostHog's own rage-click signal, grouped by route and element label. */
  private async rageClicks(window: {
    from: string;
    to: string;
  }): Promise<UxSignal[]> {
    const t = UX_SIGNAL_THRESHOLDS[UxSignalDetector.RAGE_CLICK_CLUSTER];
    return this.clickClusters(
      '$rageclick',
      UxSignalDetector.RAGE_CLICK_CLUSTER,
      'rage clicks',
      t,
      window,
    );
  }

  /**
   * Clicks on things that look interactive and are not.
   *
   * Needs `capture_dead_clicks` on the client; until that ships this query is
   * valid and simply returns nothing, which is why an empty result is never
   * treated as a failure.
   */
  private async deadClicks(window: {
    from: string;
    to: string;
  }): Promise<UxSignal[]> {
    const t = UX_SIGNAL_THRESHOLDS[UxSignalDetector.DEAD_CLICK_CLUSTER];
    return this.clickClusters(
      '$dead_click',
      UxSignalDetector.DEAD_CLICK_CLUSTER,
      'dead clicks',
      t,
      window,
    );
  }

  /** Shared shape for the two click-cluster detectors. */
  private async clickClusters(
    event: string,
    detector: UxSignalDetector,
    metricLabel: string,
    t: Record<string, number>,
    window: { from: string; to: string },
  ): Promise<UxSignal[]> {
    const rows = this.rows(
      await this.posthog.query(`
        SELECT
          path(toString(properties.$current_url)) AS route,
          toString(properties.$el_text) AS element,
          count() AS events,
          uniq(properties.$session_id) AS sessions,
          uniq(person_id) AS users
        FROM events
        WHERE event = '${event}'
          AND timestamp >= now() - INTERVAL ${UX_SIGNAL_WINDOW_DAYS} DAY
        GROUP BY route, element
        ORDER BY sessions DESC
        LIMIT 25
      `),
    );

    return rows
      .filter(
        (row) =>
          this.num(row.sessions) >= t.MIN_SESSIONS &&
          this.num(row.events) >= t.MIN_EVENTS,
      )
      .map((row) => {
        const element = this.text(row.element);
        return {
          detector,
          defaultKind: UxSignalKind.BUG,
          route: this.routeOf(row.route) || '/',
          target: element ? `element "${element}"` : undefined,
          metric: {
            name: metricLabel,
            value: this.num(row.events),
            threshold: t.MIN_EVENTS,
          },
          window,
          sessions: this.num(row.sessions),
          users: this.num(row.users),
          examples: this.examples([
            element
              ? `clicked control labelled "${element}"`
              : 'clicked control has no text label',
          ]),
        };
      });
  }

  /**
   * Routes people leave from without going anywhere else.
   *
   * Exit rate needs both halves — sessions that ended here, over sessions that
   * saw the route at all — so this is two aggregates combined in TypeScript
   * rather than one self-joining query, which the hobby deployment would feel.
   *
   * Terminal routes are excluded: leaving after a call summary is the task
   * succeeding, and without the allowlist that would be the permanent top signal.
   */
  private async routeAbandonment(window: {
    from: string;
    to: string;
  }): Promise<UxSignal[]> {
    const t = UX_SIGNAL_THRESHOLDS[UxSignalDetector.ROUTE_ABANDONMENT];

    const totals = new Map<string, { sessions: number; users: number }>();
    for (const row of this.rows(
      await this.posthog.query(`
        SELECT
          path(toString(properties.$current_url)) AS route,
          uniq(properties.$session_id) AS sessions,
          uniq(person_id) AS users
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= now() - INTERVAL ${UX_SIGNAL_WINDOW_DAYS} DAY
        GROUP BY route
        ORDER BY sessions DESC
        LIMIT 100
      `),
    )) {
      const route = this.routeOf(row.route);
      if (route) {
        totals.set(route, {
          sessions: this.num(row.sessions),
          users: this.num(row.users),
        });
      }
    }

    const exits = this.rows(
      await this.posthog.query(`
        SELECT route, count() AS exit_sessions
        FROM (
          SELECT
            properties.$session_id AS sess,
            path(toString(argMax(properties.$current_url, timestamp))) AS route
          FROM events
          WHERE timestamp >= now() - INTERVAL ${UX_SIGNAL_WINDOW_DAYS} DAY
            AND properties.$current_url IS NOT NULL
          GROUP BY sess
        )
        GROUP BY route
        ORDER BY exit_sessions DESC
        LIMIT 100
      `),
    );

    const signals: UxSignal[] = [];
    for (const row of exits) {
      const route = this.routeOf(row.route);
      if (!route || this.isTerminalRoute(route)) continue;

      const total = totals.get(route);
      if (!total || total.sessions < t.MIN_ROUTE_SESSIONS) continue;

      const exitRate = (this.num(row.exit_sessions) / total.sessions) * 100;
      if (exitRate < t.EXIT_RATE_PERCENT) continue;

      signals.push({
        detector: UxSignalDetector.ROUTE_ABANDONMENT,
        defaultKind: UxSignalKind.IMPROVEMENT,
        route,
        metric: {
          name: 'share of sessions that end on this route (%)',
          value: Number(exitRate.toFixed(1)),
          threshold: t.EXIT_RATE_PERCENT,
        },
        window,
        sessions: total.sessions,
        users: total.users,
        examples: this.examples([
          `${this.num(row.exit_sessions)} of ${total.sessions} sessions that reached ${route} went no further`,
        ]),
      });
    }
    return signals;
  }

  /**
   * Searches that found nothing, grouped by the page the search ran on.
   *
   * Deliberately NOT grouped by query text: helpline search terms can carry
   * clinical detail about a caller, so the client sends `query_length` and
   * `result_count` and never the query itself. That costs specificity — we learn
   * that search is failing people on a route, not which words fail — and that is
   * the right trade for a product handling this data.
   */
  private async zeroResultSearch(window: {
    from: string;
    to: string;
  }): Promise<UxSignal[]> {
    const t = UX_SIGNAL_THRESHOLDS[UxSignalDetector.ZERO_RESULT_SEARCH];
    const rows = this.rows(
      await this.posthog.query(`
        SELECT
          path(toString(properties.$current_url)) AS route,
          count() AS empty_searches,
          uniq(person_id) AS users,
          uniq(properties.$session_id) AS sessions,
          round(avg(toFloat(properties.query_length))) AS avg_query_length
        FROM events
        WHERE event = 'search_performed'
          AND toFloat(properties.result_count) = 0
          AND timestamp >= now() - INTERVAL ${UX_SIGNAL_WINDOW_DAYS} DAY
        GROUP BY route
        ORDER BY empty_searches DESC
        LIMIT 25
      `),
    );

    return rows
      .filter(
        (row) =>
          this.num(row.empty_searches) >= t.MIN_SEARCHES &&
          this.num(row.users) >= t.MIN_USERS,
      )
      .map((row) => ({
        detector: UxSignalDetector.ZERO_RESULT_SEARCH,
        defaultKind: UxSignalKind.IMPROVEMENT,
        route: this.routeOf(row.route) || '/',
        target: 'search',
        metric: {
          name: 'searches returning no results',
          value: this.num(row.empty_searches),
          threshold: t.MIN_SEARCHES,
        },
        window,
        sessions: this.num(row.sessions),
        users: this.num(row.users),
        examples: this.examples([
          `average query length ${this.num(row.avg_query_length)} characters (query text is deliberately not captured)`,
        ]),
      }));
  }

  /**
   * Start events far outnumbering their completion event.
   *
   * A funnel whose start event is not wired yet simply reports zero starts and
   * produces no signal — dormant, not broken.
   */
  private async funnelDropoffs(window: {
    from: string;
    to: string;
  }): Promise<UxSignal[]> {
    const t = UX_SIGNAL_THRESHOLDS[UxSignalDetector.FUNNEL_DROPOFF];
    const signals: UxSignal[] = [];

    for (const funnel of UX_SIGNAL_FUNNELS) {
      const rows = this.rows(
        await this.posthog.query(`
          SELECT
            countIf(event = '${funnel.start}') AS starts,
            countIf(event = '${funnel.complete}') AS completes,
            uniqIf(properties.$session_id, event = '${funnel.start}') AS sessions,
            uniqIf(person_id, event = '${funnel.start}') AS users
          FROM events
          WHERE event IN ('${funnel.start}', '${funnel.complete}')
            AND timestamp >= now() - INTERVAL ${UX_SIGNAL_WINDOW_DAYS} DAY
        `),
      );

      const row = rows[0];
      if (!row) continue;

      const starts = this.num(row.starts);
      if (starts < t.MIN_STARTS) continue;

      const completionRate = (this.num(row.completes) / starts) * 100;
      if (completionRate >= t.COMPLETION_RATE_PERCENT) continue;

      signals.push({
        detector: UxSignalDetector.FUNNEL_DROPOFF,
        defaultKind: UxSignalKind.IMPROVEMENT,
        route: `${funnel.label} funnel`,
        target: `${funnel.start} → ${funnel.complete}`,
        metric: {
          name: 'completion rate (%)',
          value: Number(completionRate.toFixed(1)),
          threshold: t.COMPLETION_RATE_PERCENT,
        },
        window,
        sessions: this.num(row.sessions),
        users: this.num(row.users),
        examples: this.examples([
          `${this.num(row.completes)} completions from ${starts} starts`,
        ]),
      });
    }
    return signals;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Zip PostHog's positional rows against its column names. */
  private rows(result: HogQlResult): Array<Record<string, unknown>> {
    return result.results.map((row) =>
      Object.fromEntries(result.columns.map((col, i) => [col, row[i]])),
    );
  }

  private num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /** PostHog renders absent properties as the literal strings below. */
  private text(value: unknown): string {
    const raw = typeof value === 'string' ? value.trim() : '';
    return raw === 'null' || raw === 'undefined' || raw === 'NULL' ? '' : raw;
  }

  private list(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((v) => this.text(v)).filter(Boolean)
      : [];
  }

  /** Normalise to a path, dropping any origin or query string that survived. */
  private routeOf(value: unknown): string {
    const raw = this.text(value);
    if (!raw) return '';
    const withoutQuery = raw.split('?')[0].split('#')[0];
    return withoutQuery.replace(/^https?:\/\/[^/]+/, '') || '/';
  }

  private isTerminalRoute(route: string): boolean {
    return UX_SIGNAL_TERMINAL_ROUTES.some((prefix) => route.startsWith(prefix));
  }

  /**
   * Cap and scrub sample rows.
   *
   * Free-text event properties (an error message, an element label) can pick up
   * whatever was on screen, so anything email- or phone-shaped is redacted before
   * a sample leaves this service for an LLM prompt, a findings row and an admin
   * table.
   */
  private examples(values: string[]): string[] {
    return values
      .filter(Boolean)
      .slice(0, UX_SIGNAL_LIMITS.EXAMPLES_PER_SIGNAL)
      .map((value) => this.scrubExample(value));
  }

  private scrubExample(value: string): string {
    return value
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
      .replace(/\+?\d[\d\s()-]{7,}\d/g, '[phone]')
      .slice(0, 300);
  }
}
