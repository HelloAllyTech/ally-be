import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from 'src/common/constants/user.constants';
import { GroupService } from 'src/authorization/service/group.service';
import { UserRepository } from '../repository/user.repository';
import { LoggerService } from 'src/logger/logger.service';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { AssignPlatformAdminDto } from '../dto/platform-admin.dto';

/**
 * Management of the single consolidated PLATFORM_ADMIN role — the replacement
 * for the promote/demote tier machinery in SuperDuperAdminService, now that
 * there is no tier to swap between, only one role to hold or not hold.
 * Fine-grained access is entirely via per-user feature toggles
 * (FeatureToggleService), gated on the admin_user_management toggle rather
 * than a dedicated permission pair.
 */
@Injectable()
export class PlatformAdminService {
  private readonly logger = LoggerService.getInstance(
    PlatformAdminService.name,
  );
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly userRepository: UserRepository,
    private readonly groupService: GroupService,
  ) {}

  async listPlatformAdmins(search?: string) {
    const { users, count } = await this.userRepository.getUsersWithRole(
      UserRole.PLATFORM_ADMIN,
      search,
    );
    return { data: users, count };
  }

  /** Active users who aren't already a PLATFORM_ADMIN. */
  async listEligibleUsers(search?: string) {
    const { users, count } =
      await this.userRepository.getActiveUsersWithoutRoles(
        [UserRole.PLATFORM_ADMIN],
        search,
      );
    return { data: users, count };
  }

  async assign(dto: AssignPlatformAdminDto, actingUserId: number) {
    const { userId } = dto;
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.groupService.getUserGroupNames(userId);
    if (roles.includes(UserRole.PLATFORM_ADMIN)) {
      throw new BadRequestException('User is already a platform admin');
    }

    await this.groupService.assignRole({
      role: UserRole.PLATFORM_ADMIN,
      userId,
    });

    this.logger.info(
      `User ${userId} (${user.email}) assigned PLATFORM_ADMIN by user ${actingUserId}`,
    );
    await this.auditLogger.log({
      eventType: AUDIT_EVENTS.PLATFORM_ADMIN_PROMOTED,
      userId: actingUserId,
      details: { targetUserId: userId, targetEmail: user.email },
    });

    return { success: true };
  }

  async remove(userId: number, actingUserId: number) {
    if (userId === actingUserId) {
      // Mirrors SuperDuperAdminService.demote's self-lockout guard: removing
      // your own platform-tier access must be a deliberate act by a peer.
      throw new ForbiddenException(
        'You cannot remove your own platform admin role',
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.groupService.getUserGroupNames(userId);
    if (!roles.includes(UserRole.PLATFORM_ADMIN)) {
      throw new BadRequestException('User is not a platform admin');
    }

    const { count } = await this.userRepository.getUsersWithRole(
      UserRole.PLATFORM_ADMIN,
    );
    if (count <= 1) {
      throw new BadRequestException(
        'Cannot remove the last remaining platform admin',
      );
    }

    await this.groupService.removeRole({
      role: UserRole.PLATFORM_ADMIN,
      userId,
    });

    this.logger.info(
      `User ${userId} (${user.email}) removed from PLATFORM_ADMIN by user ${actingUserId}`,
    );
    await this.auditLogger.log({
      eventType: AUDIT_EVENTS.PLATFORM_ADMIN_REMOVED,
      userId: actingUserId,
      details: { targetUserId: userId, targetEmail: user.email },
    });

    return { success: true };
  }
}
