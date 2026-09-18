import { BadRequestException, Injectable } from '@nestjs/common';
import { FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchLogsService } from '../aws/service/cloudwatch-logs.service';
import { AppConfigService, AwsLogServiceKey } from '../config/config.service';
import {
  AwsLogLevel,
  AwsLogsQueryDto,
  AwsLogStreamsQueryDto,
  AwsLogsResponseDto,
  AwsLogStreamsResponseDto,
} from './dto/aws-logs.dto';

/**
 * The substring a `level` filter has to match in each service's log lines.
 *
 * CloudWatch's plain-text filter patterns are **case-sensitive** substring
 * matches, and the three services do not spell their levels the same way:
 *
 * - `ally-be` logs through winston (`src/logger/logger.service.ts`), whose
 *   printf format leads with a lowercase, ANSI-colourised level:
 *   `\x1b[31merror\x1b[39m: [2026-09-15T…][CustomExceptionFilter] …`. The bare
 *   word is the only stable substring — the ANSI reset sits between the level
 *   and the colon, so `error:` is not contiguous, and the colours vanish
 *   entirely if `format.colorize()` is ever dropped.
 * - `ally-ai` and `ally-ai-learn` log through python's stdlib logging with a
 *   `[%(levelname)s]` field, so their levels are uppercase and bracketed —
 *   and WARN is spelled `[WARNING]`. The brackets are matched literally
 *   (verified against production), so they usefully anchor the token to the
 *   level field instead of matching the word anywhere in a message.
 *
 * Passing the DTO's uppercase level straight through — the original bug —
 * matched nothing at all from ally-be, so the admin Logs page reported "no
 * errors" for a service that was logging ~100 an hour.
 *
 * Caveat: `main.ts` keeps Nest's own ConsoleLogger alive alongside winston,
 * and it prints uppercase (`ERROR`, `WARN`, `LOG`, `DEBUG`). Those lines are
 * framework/bootstrap output and a filter pattern cannot OR two spellings
 * together (see `buildFilterPattern`), so they are not covered here; a
 * 2-hour production window contained 0 of them against 99 winston errors.
 *
 * Typed as a total `Record<AwsLogServiceKey, …>` on purpose: adding a fourth
 * service fails the build here rather than silently filtering on nothing.
 */
const LEVEL_FILTER_TOKENS: Record<
  AwsLogServiceKey,
  Record<AwsLogLevel, string>
> = {
  'ally-be': { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
  'ally-ai': {
    ERROR: '[ERROR]',
    WARN: '[WARNING]',
    INFO: '[INFO]',
    DEBUG: '[DEBUG]',
  },
  'ally-ai-learn': {
    ERROR: '[ERROR]',
    WARN: '[WARNING]',
    INFO: '[INFO]',
    DEBUG: '[DEBUG]',
  },
};

@Injectable()
export class LogsService {
  /**
   * `FilterLogEvents` scans a bounded slice of the log group per call and
   * returns only what matched inside that slice — so a page can come back
   * empty and still carry a `nextToken`, and a selective filter over a wide
   * window returns a long run of empty pages. Measured against production:
   * 7 days of ally-ai holds 7 `[ERROR]` lines spread over 178 pages, and 7
   * days of ally-ai-learn holds 13 over 15 pages.
   *
   * The Logs page renders the first empty page as "no results", which is the
   * second reason it looked like it had no data. A monitoring surface that
   * under-reports costs more trust than it saves ("Proactive incident
   * detection builds stakeholder trust"), so follow the cursor here until
   * there is something to show.
   *
   * The wall-clock budget is the real governor — it keeps one request bounded
   * however sparse the window is — and the page cap is only a guard against
   * spinning on pages that return instantly. A scan that runs out of budget
   * still hands the cursor back, so "Next" resumes where it stopped rather
   * than restarting; the 178-page case needs a few of those.
   */
  private static readonly MAX_EMPTY_PAGE_FOLLOWS = 200;
  private static readonly EMPTY_PAGE_FOLLOW_BUDGET_MS = 5000;

  constructor(
    private readonly cloudWatchLogsService: CloudWatchLogsService,
    private readonly config: AppConfigService,
  ) {}

  private resolveLogGroup(service: AwsLogServiceKey): string {
    const logGroupName = this.config.awsLogs.logGroups[service];
    if (!logGroupName) {
      throw new BadRequestException(
        `No CloudWatch log group configured for "${service}". Set the corresponding AWS_LOG_GROUP_* env var.`,
      );
    }
    return logGroupName;
  }

  /**
   * CloudWatch ANDs space-separated quoted terms in a plain-text filter
   * pattern. It cannot mix that with the `?term` OR form, so `level` resolves
   * to exactly one token per service (see `LEVEL_FILTER_TOKENS`) rather than
   * an OR over spellings — which keeps `level` + `search` a plain AND however
   * the two are combined.
   */
  private buildFilterPattern(
    service: AwsLogServiceKey,
    params: { level?: AwsLogLevel; search?: string },
  ): string | undefined {
    const terms: string[] = [];
    if (params.level) {
      terms.push(`"${LEVEL_FILTER_TOKENS[service][params.level]}"`);
    }
    if (params.search) terms.push(`"${params.search.replace(/"/g, '')}"`);
    return terms.length > 0 ? terms.join(' ') : undefined;
  }

  async getLogEvents(query: AwsLogsQueryDto): Promise<AwsLogsResponseDto> {
    const logGroupName = this.resolveLogGroup(query.service);
    const filterPattern = this.buildFilterPattern(query.service, {
      level: query.level,
      search: query.search,
    });

    const deadline = Date.now() + LogsService.EMPTY_PAGE_FOLLOW_BUDGET_MS;
    let events: FilteredLogEvent[] = [];
    let nextToken = query.nextToken;

    // One initial call, then at most MAX_EMPTY_PAGE_FOLLOWS more — and only
    // while the page came back completely empty, so a page that has anything
    // to show is returned untouched and `limit` keeps its meaning.
    for (let call = 0; call <= LogsService.MAX_EMPTY_PAGE_FOLLOWS; call++) {
      const page = await this.cloudWatchLogsService.filterLogEvents({
        logGroupName,
        startTime: query.startTime,
        endTime: query.endTime,
        filterPattern,
        logStreamNamePrefix: query.logStreamName,
        nextToken,
        limit: query.limit,
      });
      events = page.events;
      nextToken = page.nextToken;

      if (events.length > 0 || !nextToken || Date.now() >= deadline) break;
    }

    return {
      events: events.map((event) => ({
        timestamp: event.timestamp ?? 0,
        message: event.message ?? '',
        logStreamName: event.logStreamName ?? '',
        eventId: event.eventId ?? '',
      })),
      nextToken,
    };
  }

  async listLogStreams(
    query: AwsLogStreamsQueryDto,
  ): Promise<AwsLogStreamsResponseDto> {
    const logGroupName = this.resolveLogGroup(query.service);

    const { streams, nextToken } =
      await this.cloudWatchLogsService.listLogStreams({
        logGroupName,
        nextToken: query.nextToken,
      });

    return {
      streams: streams.map((stream) => ({
        name: stream.logStreamName ?? '',
        lastEventTime: stream.lastEventTimestamp,
      })),
      nextToken,
    };
  }
}
