import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../scheduler/registry/scheduled-task.registry';
import { MobileReleasesService } from './mobile-releases.service';

@Injectable()
export class IosMinVersionAutoBumpSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly mobileReleasesService: MobileReleasesService) {}

  onModuleInit(): void {
    // 30min: Apple's own review-to-release timeline is measured in hours, and this
    // only exists to catch a version turning READY_FOR_DISTRIBUTION shortly after a
    // human clicks Release in App Store Connect — no need to poll faster than that.
    scheduledTaskRegistry.register('30min', 'ios-min-version-auto-bump', () =>
      this.mobileReleasesService.autoBumpIosMinimumVersionIfLive(),
    );
  }
}
