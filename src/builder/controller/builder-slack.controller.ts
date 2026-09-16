import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from 'src/auth/decorators/auth.metadata';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderSlackService } from '../service/builder-slack.service';
import { verifySlackSignature } from '../util/slack-signature.util';

/**
 * Slack's interactivity webhook.
 *
 * Public by necessity — Slack calls it, and Slack cannot present a bearer token
 * — which makes the signature check the entire access control for a URL that
 * merges to master. It runs before anything is parsed or looked up, and a
 * failure is a 401 with nothing else attempted.
 *
 * Excluded from Swagger deliberately: it is not an API anyone should call, and
 * publishing its shape only helps someone trying to forge a payload.
 */
@ApiExcludeController()
// Versioned like every other controller in this module. Without the explicit
// version the route is registered outside the /v1 namespace, which is both
// inconsistent and a URL somebody has to remember is special — and this one
// gets pasted into Slack's app configuration, where a later correction means
// reconfiguring it there too.
@Controller({ path: 'builder/slack', version: '1' })
export class BuilderSlackController {
  private readonly logger = LoggerService.getInstance(
    BuilderSlackController.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly slackService: BuilderSlackService,
  ) {}

  /**
   * One button press.
   *
   * Slack expects a 200 within three seconds and renders whatever text comes
   * back in place of the message's context. `response_type: 'ephemeral'` keeps
   * the answer visible only to the person who clicked — a refusal is between
   * them and the bot, and a channel does not need a running log of who was not
   * on the approver list.
   */
  @Public()
  @Post('interact')
  async interact(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: { payload?: string },
  ): Promise<{ response_type: string; text: string } | Record<string, never>> {
    const verdict = verifySlackSignature({
      signingSecret: this.configService.slack.signingSecret,
      signature: req.header('x-slack-signature'),
      timestamp: req.header('x-slack-request-timestamp'),
      rawBody: req.rawBody,
    });

    if (!verdict.ok) {
      // The reason is logged and never returned: telling a caller whether the
      // secret is unset, the timestamp stale or the signature wrong is telling
      // them how to get closer.
      this.logger.warn(`Rejected a Slack interaction: ${verdict.reason}.`);
      throw new UnauthorizedException();
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(body?.payload ?? '{}');
    } catch {
      this.logger.warn('Slack interaction carried an unparseable payload.');
      return {};
    }

    const result = await this.slackService.handleInteraction(payload);
    // An empty text is a silent acknowledgement — a link button, or an action
    // that is not ours. Returning a body with no text would post a blank
    // message under the original.
    if (!result.text) return {};
    return { response_type: 'ephemeral', text: result.text };
  }
}
