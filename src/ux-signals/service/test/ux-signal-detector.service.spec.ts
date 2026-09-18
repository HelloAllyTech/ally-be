import { Test, TestingModule } from '@nestjs/testing';

import { UxSignalDetectorService } from '../ux-signal-detector.service';
import { PosthogQueryService } from '../posthog-query.service';
import { UxSignalDetector } from '../../enum/ux-signal.enum';

/**
 * The detectors are where a scan earns or loses a reader's trust: everything
 * downstream treats a signal as "this crossed a line", so a threshold that fires
 * on noise costs a human a review cycle every night.
 *
 * These tests drive real HogQL result shapes through the service and assert on
 * what survives, rather than asserting on the SQL text — the query is an
 * implementation detail, the threshold decision is the contract.
 */
describe('UxSignalDetectorService', () => {
  let service: UxSignalDetectorService;
  let query: jest.Mock;

  /** PostHog returns named columns plus positional rows; so does this. */
  const result = (columns: string[], rows: unknown[][]) => ({
    columns,
    results: rows,
  });

  const empty = { columns: [], results: [] };

  /**
   * Answers whichever detector's query is asked, keyed on a fragment of it, and
   * returns empty for the rest. Lets one test isolate one detector without
   * stubbing all seven.
   */
  const respondTo = (matchers: Array<[RegExp, unknown]>) =>
    jest.fn(async (sql: string) => {
      for (const [pattern, response] of matchers) {
        if (pattern.test(sql)) return response;
      }
      return empty;
    });

  const build = async (queryMock: jest.Mock) => {
    query = queryMock;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UxSignalDetectorService,
        { provide: PosthogQueryService, useValue: { query, enabled: true } },
      ],
    }).compile();
    return module.get(UxSignalDetectorService);
  };

  afterEach(() => jest.clearAllMocks());

  describe('api_error_spike', () => {
    const columns = [
      'endpoint',
      'recent',
      'total',
      'sessions',
      'users',
      'codes',
      'route',
    ];

    it('fires when an endpoint errors well above its own weekly baseline', async () => {
      // 40 errors yesterday against a trailing mean of ~10/day.
      service = await build(
        respondTo([
          [
            /AS recent/,
            result(columns, [
              ['getScenarios', 40, 110, 12, 9, ['500'], '/simulations'],
            ]),
          ],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      const spike = signals.find(
        (s) => s.detector === UxSignalDetector.API_ERROR_SPIKE,
      );

      expect(spike).toBeDefined();
      expect(spike!.target).toBe('getScenarios');
      expect(spike!.route).toBe('/simulations');
      expect(spike!.metric.value).toBe(40);
      // (110 - 40) / 7 = 10/day, so the threshold it had to clear was 20.
      expect(spike!.metric.baseline).toBe(10);
      expect(spike!.metric.threshold).toBe(20);
    });

    it('stays quiet when the volume is high but flat', async () => {
      // 20 yesterday against a mean of ~20/day is business as usual — the
      // absolute number is large, which is exactly the case a platform-wide
      // threshold would misread as a problem.
      service = await build(
        respondTo([
          [
            /AS recent/,
            result(columns, [
              ['getScenarios', 20, 160, 12, 9, ['500'], '/simulations'],
            ]),
          ],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      expect(
        signals.filter((s) => s.detector === UxSignalDetector.API_ERROR_SPIKE),
      ).toHaveLength(0);
    });

    it('requires breadth, not just volume', async () => {
      // 40 errors from a single session is one person's bad afternoon, or a
      // retry loop — not a platform signal, and it must not file a bug.
      service = await build(
        respondTo([
          [
            /AS recent/,
            result(columns, [
              ['getScenarios', 40, 45, 1, 1, ['500'], '/simulations'],
            ]),
          ],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      expect(
        signals.filter((s) => s.detector === UxSignalDetector.API_ERROR_SPIKE),
      ).toHaveLength(0);
    });

    it('uses an absolute floor for an endpoint with no error history', async () => {
      // No baseline to multiply: 6 errors where there have never been any is
      // news, and multiplying zero would let it through at any volume.
      service = await build(
        respondTo([
          [
            /AS recent/,
            result(columns, [['postFeedback', 6, 6, 4, 4, [], '/summary']]),
          ],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      const spike = signals.find(
        (s) => s.detector === UxSignalDetector.API_ERROR_SPIKE,
      );
      expect(spike).toBeDefined();
      expect(spike!.metric.threshold).toBe(5);
    });
  });

  describe('route_abandonment', () => {
    it('excludes routes where leaving is the task succeeding', async () => {
      // Without the terminal-route allowlist this is the permanent top signal:
      // people do leave after a call summary, because they are finished.
      service = await build(
        respondTo([
          [
            /event = '\$pageview'/,
            result(
              ['route', 'sessions', 'users'],
              [
                ['/post-call-summary', 400, 120],
                ['/resources', 200, 90],
              ],
            ),
          ],
          [
            /argMax/,
            result(
              ['route', 'exit_sessions'],
              [
                ['/post-call-summary', 380],
                ['/resources', 160],
              ],
            ),
          ],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      const routes = signals
        .filter((s) => s.detector === UxSignalDetector.ROUTE_ABANDONMENT)
        .map((s) => s.route);

      expect(routes).toContain('/resources');
      expect(routes).not.toContain('/post-call-summary');
    });

    it('ignores a high exit rate on a route too small to mean anything', async () => {
      // 4 of 5 sessions is 80%, and says nothing at all.
      service = await build(
        respondTo([
          [
            /event = '\$pageview'/,
            result(['route', 'sessions', 'users'], [['/rare', 5, 4]]),
          ],
          [/argMax/, result(['route', 'exit_sessions'], [['/rare', 4]])],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      expect(
        signals.filter(
          (s) => s.detector === UxSignalDetector.ROUTE_ABANDONMENT,
        ),
      ).toHaveLength(0);
    });
  });

  describe('resilience and hygiene', () => {
    it('names a failed detector and still returns the others', async () => {
      // A self-hosted PostHog may lack a function or have never seen an event.
      // One unsupported query must not cost the whole scan.
      service = await build(
        jest.fn(async (sql: string) => {
          if (/\$rageclick/.test(sql)) throw new Error('unsupported function');
          if (/AS recent/.test(sql)) {
            return result(
              [
                'endpoint',
                'recent',
                'total',
                'sessions',
                'users',
                'codes',
                'route',
              ],
              [['getScenarios', 40, 110, 12, 9, ['500'], '/simulations']],
            );
          }
          return empty;
        }),
      );

      const { signals, failedDetectors } = await service.detect(
        '2026-08-20',
        '2026-08-27',
      );

      expect(failedDetectors).toContain(UxSignalDetector.RAGE_CLICK_CLUSTER);
      expect(
        signals.some((s) => s.detector === UxSignalDetector.API_ERROR_SPIKE),
      ).toBe(true);
    });

    it('redacts person-shaped text from sample rows', async () => {
      // Free-text event properties pick up whatever was on screen, and these
      // samples travel into an LLM prompt, a findings row and an admin table.
      service = await build(
        respondTo([
          [
            /\$rageclick/,
            result(
              ['route', 'element', 'events', 'sessions', 'users'],
              [['/inbox', 'Retry sending to a.person@example.com', 9, 5, 5]],
            ),
          ],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      const rage = signals.find(
        (s) => s.detector === UxSignalDetector.RAGE_CLICK_CLUSTER,
      );

      expect(rage).toBeDefined();
      expect(rage!.examples.join(' ')).toContain('[email]');
      expect(rage!.examples.join(' ')).not.toContain('a.person@example.com');
    });

    it('normalises a full URL down to a path so findings dedupe', async () => {
      // The same route reached via a different origin or query string has to
      // produce the same coordinate, or every environment files its own copy.
      service = await build(
        respondTo([
          [
            /\$rageclick/,
            result(
              ['route', 'element', 'events', 'sessions', 'users'],
              [['https://helpline.example.com/inbox?tab=2', 'Retry', 9, 5, 5]],
            ),
          ],
        ]),
      );

      const { signals } = await service.detect('2026-08-20', '2026-08-27');
      const rage = signals.find(
        (s) => s.detector === UxSignalDetector.RAGE_CLICK_CLUSTER,
      );
      expect(rage!.route).toBe('/inbox');
    });
  });
});
