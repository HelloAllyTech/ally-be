import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../scheduler/registry/scheduled-task.registry';
import { MobileReleasesService } from './mobile-releases.service';

@Injectable()
export class AndroidMinVersionAutoBumpSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly mobileReleasesService: MobileReleasesService) {}

  onModuleInit(): void {
    // Registered unconditionally, same 30min cadence as the iOS task — the actual gate is
    // AppConfigService.androidMinVersionAutoBumpEnabled (default off), checked inside the
    // handler itself. See autoBumpAndroidMinimumVersionIfLive()'s own doc comment for why
    // this one specifically needs an explicit opt-in the iOS task doesn't.
    scheduledTaskRegistry.register(
      '30min',
      'android-min-version-auto-bump',
      () => this.mobileReleasesService.autoBumpAndroidMinimumVersionIfLive(),
    );
  }
}
