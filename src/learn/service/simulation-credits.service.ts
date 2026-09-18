import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  ForbiddenException,
} from '@nestjs/common';
import { SimulationCreditsRepository } from '../repository/simulation-credits.repository';
import { SimulationCredits } from '../entity/simulation-credits.entity';
import { SimulationCreditsResponseDto } from '../dto/simulation-credits-response.dto';
import { UpdateSimulationCreditsDto } from '../dto/update-simulation-credits.dto';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';
import { PostHog } from 'posthog-node';
import {
  ADMIN_ANALYTICS_EVENTS,
  LOW_CREDIT_THRESHOLD_RATIOS,
} from 'src/posthog/admin-analytics.constants';
import { userDistinctId } from 'src/posthog/posthog.util';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class SimulationCreditsService {
  private readonly logger = LoggerService.getInstance(
    SimulationCreditsService.name,
  );

  constructor(
    private readonly simulationCreditsRepository: SimulationCreditsRepository,
    private readonly permissionValidator: PermissionValidator,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly configService: AppConfigService,
    private readonly posthog: PostHog,
  ) {}

  async getSimulationCredits(
    tokenUserId: number,
    userId?: number,
  ): Promise<SimulationCreditsResponseDto> {
    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      tokenUserId,
      [PERMISSIONS.SYSTEM_ACCESS],
    );

    const targetUserId = hasSystemAccess ? userId : tokenUserId;
    if (!targetUserId) {
      throw new BadRequestException('User ID is required');
    }
    // to handle case where learner trying to access another user's simulation credits by passing userId as query param
    if (!hasSystemAccess && !!userId && userId !== tokenUserId) {
      throw new ForbiddenException(
        "You are not allowed to access this user's simulation credits",
      );
    }
    if (hasSystemAccess) {
      const isValidUser = await this.userService.isValidUser(targetUserId!);
      if (!isValidUser) {
        throw new BadRequestException('User not found');
      }
    }
    const credits =
      await this.simulationCreditsRepository.findByUserId(targetUserId);

    const secondsAllowedPerCredit =
      this.configService.simulationCredits.lifespanSecondsPerCredit ?? 60;
    if (!credits) {
      return {
        creditLimit: 0,
        consumedCredits: 0,
        secondsAllowedPerCredit,
      };
    }

    return {
      creditLimit: credits.creditLimit,
      consumedCredits: credits.consumedCredits,
      secondsAllowedPerCredit,
    };
  }

  async updateSimulationCredits(
    updateDto: UpdateSimulationCreditsDto,
  ): Promise<{ success: boolean }> {
    const { userId, creditLimit } = updateDto;
    // check if the user is allowed to start a scenario session to make sure given id  belongs to a learner role
    const isCreateScenarioSessionAllowed =
      await this.permissionValidator.validatePermissions(userId, [
        PERMISSIONS.EDIT_SCENARIO_SESSION,
      ]);
    if (!isCreateScenarioSessionAllowed) {
      throw new BadRequestException('Given user id is invalid');
    }
    const existing =
      await this.simulationCreditsRepository.findByUserId(userId);

    if (existing) {
      if (creditLimit < existing.consumedCredits) {
        throw new BadRequestException(
          `Total credits (${creditLimit}) cannot be less than consumed credits (${existing.consumedCredits})`,
        );
      }
    }

    const updated = await this.simulationCreditsRepository.createOrUpdate(
      userId,
      creditLimit,
    );
    if (!updated) {
      throw new InternalServerErrorException(
        'Failed to update simulation credits',
      );
    }
    return { success: true };
  }

  async consumeCredits(
    userId: number,
    creditsToConsume: number,
  ): Promise<boolean> {
    if (creditsToConsume <= 0) {
      throw new BadRequestException(
        'Credits to consume must be greater than 0',
      );
    }

    // Read before consuming: `credit.threshold_reached` is about the *crossing*,
    // so it needs the balance on both sides of this deduction.
    const before = await this.simulationCreditsRepository.findByUserId(userId);

    const success = await this.simulationCreditsRepository.consumeCredits(
      userId,
      creditsToConsume,
    );

    if (!success) {
      throw new BadRequestException('Error consuming credits');
    }

    this.captureCreditThresholdReached(userId, before, creditsToConsume);

    return true;
  }

  /**
   * `credit.threshold_reached` — this deduction took the learner past a
   * low-credit mark (see `LOW_CREDIT_THRESHOLD_RATIOS`).
   *
   * Fires only on the crossing, never on every session below the line, which is
   * what makes it usable as a top-up trigger without storing "already warned"
   * state: a mark counts as crossed when the balance was above it before and is
   * at or below it after.
   *
   * The post-deduction balance is computed rather than re-read, mirroring the
   * repository's `CASE` (which clamps at the limit instead of going negative) —
   * one query instead of two, and the two halves of the comparison then come
   * from the same snapshot.
   *
   * `org_id` comes from the request context, since credits are stored per user
   * with no tenant column of their own; a session ended outside a request
   * context reports none rather than a wrong one. Wholly guarded — analytics
   * must never fail a learner's session teardown.
   */
  private captureCreditThresholdReached(
    userId: number,
    before: SimulationCredits | null,
    creditsConsumed: number,
  ): void {
    try {
      if (!before?.creditLimit) return;

      const { creditLimit, consumedCredits } = before;
      const remainingBefore = creditLimit - consumedCredits;
      const remainingAfter = Math.max(0, remainingBefore - creditsConsumed);

      const crossed = LOW_CREDIT_THRESHOLD_RATIOS.find(
        (ratio) =>
          remainingBefore > creditLimit * ratio &&
          remainingAfter <= creditLimit * ratio,
      );
      if (crossed === undefined) return;

      this.posthog.capture({
        distinctId: userDistinctId(userId),
        event: ADMIN_ANALYTICS_EVENTS.CREDIT_THRESHOLD_REACHED,
        properties: {
          org_id: ExecutionManager.getTenantId(),
          credits_remaining: remainingAfter,
          credit_limit: creditLimit,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to capture ${ADMIN_ANALYTICS_EVENTS.CREDIT_THRESHOLD_REACHED} in PostHog for userId ${userId}: ${error}`,
      );
    }
  }
}
