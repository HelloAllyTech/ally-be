import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FillerQualityPointDto,
  FillerQualityQueryDto,
} from '../dto/platform-analytics.dto';
import {
  FillerAnalyticsRepository,
  FillerBucket,
} from '../repository/filler-analytics.repository';

/** Days covered by each rolling range. Mirrors the language dashboard's. */
const RANGE_DAYS: Record<string, number> = {
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

/**
 * Read side of the thinking-filler evaluation.
 *
 * Thin on purpose: the rates are SQL (see FillerAnalyticsRepository), because
 * computing them at read time is what lets a weighting change without
 * re-judging the corpus. This resolves the window and nothing else.
 */
@Injectable()
export class FillerAnalyticsService {
  constructor(private readonly repo: FillerAnalyticsRepository) {}

  async getFillerQuality(
    query: FillerQualityQueryDto,
  ): Promise<FillerQualityPointDto[]> {
    const { since, until } = this.resolveWindow(query);
    return this.repo.findingRates({
      since,
      until,
      bucket: query.bucket as FillerBucket | undefined,
    });
  }

  /**
   * Resolve the query into an inclusive ISO date window.
   *
   * `range=all` is rejected rather than quietly served as 90 days: this
   * dashboard's whole job is comparing a period against another, and silently
   * substituting a different period would make two charts disagree with no
   * indication why.
   */
  private resolveWindow(query: FillerQualityQueryDto): {
    since: string;
    until: string;
  } {
    if (query.from && query.to) {
      return { since: query.from, until: query.to };
    }
    const range = query.range ?? '30d';
    if (range === 'all') {
      throw new BadRequestException(
        'range=all is not supported by this endpoint',
      );
    }
    const days = RANGE_DAYS[range];
    if (!days) {
      throw new BadRequestException(`unsupported range: ${range}`);
    }
    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
    return {
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    };
  }
}
