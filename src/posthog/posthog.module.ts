import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { AppConfigService } from '../config/config.service';
import { LoggerService } from '../logger/logger.service';

/**
 * Single PostHog client for the process, injectable as `PostHog`.
 *
 * Global because product analytics are captured from controllers all over the
 * app; making every module import this one would be noise. `main.ts` pulls the
 * same instance out of the container for `PostHogInterceptor` rather than
 * constructing a second client — two clients means two event queues, two flush
 * timers and duplicated `$feature_flag_called` traffic.
 */
@Global()
@Module({
  providers: [
    {
      provide: PostHog,
      inject: [AppConfigService],
      useFactory: (appConfigService: AppConfigService) => {
        const { apiKey, host } = appConfigService.posthog;
        // No key configured — local, CI and the test suites. A disabled client
        // turns every `capture` into a no-op, so call sites stay free of null
        // checks and nothing tries to reach the network.
        return new PostHog(apiKey || 'phc-analytics-disabled', {
          host,
          disabled: !apiKey,
        });
      },
    },
  ],
  exports: [PostHog],
})
export class PostHogModule implements OnApplicationShutdown {
  private readonly logger = LoggerService.getInstance(PostHogModule.name);

  constructor(private readonly posthog: PostHog) {}

  /**
   * Events are batched in memory, so a deploy or scale-in drops whatever has
   * not been flushed yet unless we drain on shutdown. `main.ts` already calls
   * `enableShutdownHooks()`, which is what gets us here.
   */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.posthog.shutdown();
    } catch (error) {
      this.logger.error('Failed to flush PostHog events on shutdown', error);
    }
  }
}
