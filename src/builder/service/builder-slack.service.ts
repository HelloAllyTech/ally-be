import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderPullRequestService } from './builder-pull-request.service';
import { BuilderPullRequestRepository } from '../repository/builder-build.repository';

/**
 * Acting on a button pressed in Slack.
 *
 * The convenience is small — it removes a trip to GitHub — and the exposure is
 * not, because the thing behind the button merges to master and, with
 * auto-release on, ships. So this is written as an authorisation gate that
 * happens to also merge, rather than a merge that happens to check something.
 *
 * Three refusals, in order, and each returns a sentence a person can act on:
 *
 *  1. **Not an approver.** A Slack channel is not an authorisation model: its
 *     membership is whoever was ever invited, and Slack user ids are not Ally
 *     accounts. The allowlist is explicit and deny-by-default, so an unset
 *     `BUILDER_SLACK_APPROVERS` means nobody rather than everybody.
 *  2. **Not a pull request we announced.** The button carries the row id, and
 *     this looks it up. A repo/number pair out of a payload would let a forged
 *     request name any pull request in any repo.
 *  3. **GitHub says no.** Passed through verbatim rather than retried with
 *     force — "a required review is missing" or "the base branch was modified"
 *     are both things the person can fix, and neither is a reason to bypass a
 *     gate from a chat message.
 */
@Injectable()
export class BuilderSlackService {
  private readonly logger = LoggerService.getInstance(BuilderSlackService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly pullRequestService: BuilderPullRequestService,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
  ) {}

  private isApprover(slackUserId: string | null | undefined): boolean {
    if (!slackUserId) return false;
    return this.configService.builder.slackApprovers.includes(slackUserId);
  }

  /**
   * Handle one interaction payload.
   *
   * Always resolves with a message for Slack to show the clicker. Slack gives
   * three seconds before it shows the user an error of its own, and a refusal
   * they can read beats a timeout they cannot.
   */
  async handleInteraction(payload: {
    type?: string;
    user?: { id?: string; username?: string };
    actions?: { action_id?: string; value?: string }[];
  }): Promise<{ text: string }> {
    const action = (payload.actions ?? [])[0];
    const actionId = action?.action_id;

    // A link button is handled by Slack itself and still posts an interaction.
    // Acknowledging silently is correct; treating it as unknown would put a
    // confusing message under every "Open on GitHub" click.
    if (!actionId || actionId === 'builder_open_pr') return { text: '' };

    if (actionId !== 'builder_merge') {
      this.logger.warn(`Ignoring unknown Slack action ${actionId}.`);
      return { text: '' };
    }

    const slackUserId = payload.user?.id;
    if (!this.isApprover(slackUserId)) {
      // Logged with the id so an admin can add it if the refusal was wrong;
      // the person is told plainly rather than left wondering.
      this.logger.warn(
        `Slack merge refused for user ${slackUserId ?? 'unknown'}: not on the approver list.`,
      );
      return {
        text: "You're not on Builder's approver list, so I can't merge from here. An admin can add your Slack ID to BUILDER_SLACK_APPROVERS.",
      };
    }

    const pullRequestId = action?.value;
    const row = pullRequestId
      ? await this.pullRequestRepository.findOne({
          where: { id: pullRequestId },
        })
      : null;
    if (!row) {
      return { text: "I can't find that pull request any more." };
    }
    if (row.merged) {
      return { text: `${row.repo}#${row.prNumber} is already merged.` };
    }

    // `mergePullRequest` refuses by throwing, and its messages are written for
    // a person — "checks are not green", "closed without being merged", the
    // reason GitHub itself gave. Relaying them beats inventing a worse
    // sentence, and every one of these refusals is something the clicker can
    // act on.
    try {
      const merged = await this.pullRequestService.mergePullRequest(
        row.sessionId,
        row.id,
        // Attributed to the platform rather than an Ally user, because a Slack
        // id is not one. The log line below carries who actually clicked, which
        // is the record that matters.
        0,
      );

      if (!merged.merged) {
        return {
          text: `GitHub wouldn't merge ${row.repo}#${row.prNumber}. It's still open — have a look on GitHub.`,
        };
      }

      this.logger.info(
        `[BUILDER] ${row.repo}#${row.prNumber} merged from Slack by ${slackUserId}.`,
      );
      return {
        text: `Merged ${row.repo}#${row.prNumber}. Its production release starts on the next reconcile, and I'll say here if it doesn't reach production.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Slack merge of ${row.repo}#${row.prNumber} refused: ${message}`,
      );
      return {
        text: `I couldn't merge ${row.repo}#${row.prNumber}: ${message}`,
      };
    }
  }
}
