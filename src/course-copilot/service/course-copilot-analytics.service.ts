import { Injectable } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { LoggerService } from 'src/logger/logger.service';
import { userDistinctId } from 'src/posthog/posthog.util';

/**
 * Course Copilot's funnel, captured server-side: the admin console has no
 * PostHog client, and these are moments only the server sees whole anyway (a
 * build finishes with nobody watching). Named `noun.verb` like the other
 * server-side events (src/posthog/admin-analytics.constants.ts).
 *
 * Properties are counts, ids and money only — never brief text, course
 * content or anything a trainer typed.
 */
export const COURSE_COPILOT_ANALYTICS_EVENTS = {
  /** A new session — CREATE (interview) or EDIT (opened on an existing course). */
  SESSION_STARTED: 'course_copilot.session_started',
  /** The trainer approved a blueprint and the build started. */
  BLUEPRINT_APPROVED: 'course_copilot.blueprint_approved',
  /** Every job of a build settled (or the trainer cancelled it). */
  BUILD_FINISHED: 'course_copilot.build_finished',
  /** The copilot published a course after the trainer confirmed. */
  COURSE_PUBLISHED: 'course_copilot.course_published',
} as const;

@Injectable()
export class CourseCopilotAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotAnalyticsService.name,
  );

  constructor(private readonly posthog: PostHog) {}

  /** Wholly guarded: analytics must never fail what it is measuring. */
  capture(
    event: (typeof COURSE_COPILOT_ANALYTICS_EVENTS)[keyof typeof COURSE_COPILOT_ANALYTICS_EVENTS],
    userId: number,
    properties: Record<string, string | number | boolean | null>,
  ): void {
    try {
      this.posthog.capture({
        distinctId: userDistinctId(userId),
        event,
        properties,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to capture ${event}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
