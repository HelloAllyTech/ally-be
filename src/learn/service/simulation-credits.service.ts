import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  ForbiddenException,
} from '@nestjs/common';
import { SimulationCreditsRepository } from '../repository/simulation-credits.repository';
import { SimulationCreditsResponseDto } from '../dto/simulation-credits-response.dto';
import { UpdateSimulationCreditsDto } from '../dto/update-simulation-credits.dto';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class SimulationCreditsService {
  constructor(
    private readonly simulationCreditsRepository: SimulationCreditsRepository,
    private readonly permissionValidator: PermissionValidator,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly configService: AppConfigService,
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

    const success = await this.simulationCreditsRepository.consumeCredits(
      userId,
      creditsToConsume,
    );

    if (!success) {
      throw new BadRequestException('Error consuming credits');
    }

    return true;
  }
}
