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
import {
  PromoteSuperAdminDto,
  PromoteSuperDuperAdminDto,
} from '../dto/super-duper-admin.dto';

/**
 * Management of the super-admin tier (SUPER_ADMIN + SUPER_DUPER_ADMIN) — the
 * official replacement for the one-off "Promote<Name>ToSuperDuperAdmin" SQL
 * migrations. Only reachable via the view/edit:super-duper-admins permissions,
 * which are granted exclusively to SUPER_DUPER_ADMIN.
 *
 * Promote/demote mirror the migrations' semantics: the elevated tier is a
 * replacement for SUPER_ADMIN, not an addition — promote swaps
 * SUPER_ADMIN → SUPER_DUPER_ADMIN, demote swaps back. Role changes go through
 * GroupService so the Redis `user:groups:*` / `user:roles:*` caches are busted
 * and role events fire; permission caches need no flush because both tiers'
 * group→permission rows are static.
 */
@Injectable()
export class SuperDuperAdminService {
  private readonly logger = LoggerService.getInstance(
    SuperDuperAdminService.name,
  );
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly userRepository: UserRepository,
    private readonly groupService: GroupService,
  ) {}

  async listSuperDuperAdmins(search?: string) {
    const { users, count } = await this.userRepository.getUsersWithRole(
      UserRole.SUPER_DUPER_ADMIN,
      search,
    );
    return { data: users, count };
  }

  async listSuperAdmins(search?: string) {
    const { users, count } = await this.userRepository.getUsersWithRole(
      UserRole.SUPER_ADMIN,
      search,
    );
    return { data: users, count };
  }

  /**
   * Candidates for "add super admin": ACTIVE users who aren't already in the
   * super-admin tier. Capped result set — callers narrow with `search`.
   */
  async listSuperAdminCandidates(search?: string) {
    const { users, count } =
      await this.userRepository.getActiveUsersWithoutRoles(
        [UserRole.SUPER_ADMIN, UserRole.SUPER_DUPER_ADMIN],
        search,
      );
    return { data: users, count };
  }

  /**
   * Makes an existing user a SUPER_ADMIN. Additive — the user keeps their
   * other roles (permissions are unioned across roles), unlike the
   * SUPER_ADMIN → SUPER_DUPER_ADMIN promotion which swaps within the tier.
   */
  async promoteToSuperAdmin(dto: PromoteSuperAdminDto, actingUserId: number) {
    const { userId } = dto;
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.groupService.getUserGroupNames(userId);
    if (
      roles.includes(UserRole.SUPER_ADMIN) ||
      roles.includes(UserRole.SUPER_DUPER_ADMIN)
    ) {
      throw new BadRequestException('User is already in the super-admin tier');
    }

    await this.groupService.assignRole({ role: UserRole.SUPER_ADMIN, userId });

    this.logger.info(
      `User ${userId} (${user.email}) promoted to SUPER_ADMIN by user ${actingUserId}`,
    );
    await this.auditLogger.log({
      eventType: 'SUPER_ADMIN_PROMOTED',
      userId: actingUserId,
      details: { targetUserId: userId, targetEmail: user.email },
    });

    return { success: true };
  }

  /**
   * Removes the SUPER_ADMIN role from a user (their other roles are kept;
   * GroupService rejects removing a user's last remaining role). Super duper
   * admins must be demoted through demote() instead.
   */
  async removeSuperAdmin(userId: number, actingUserId: number) {
    if (userId === actingUserId) {
      throw new ForbiddenException(
        'You cannot remove your own super admin role',
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.groupService.getUserGroupNames(userId);
    if (roles.includes(UserRole.SUPER_DUPER_ADMIN)) {
      throw new BadRequestException(
        'Demote the super duper admin first, then remove the super admin role',
      );
    }
    if (!roles.includes(UserRole.SUPER_ADMIN)) {
      throw new BadRequestException('User is not a super admin');
    }

    await this.groupService.removeRole({ role: UserRole.SUPER_ADMIN, userId });

    this.logger.info(
      `User ${userId} (${user.email}) removed from SUPER_ADMIN by user ${actingUserId}`,
    );
    await this.auditLogger.log({
      eventType: 'SUPER_ADMIN_REMOVED',
      userId: actingUserId,
      details: { targetUserId: userId, targetEmail: user.email },
    });

    return { success: true };
  }

  /**
   * Users eligible for promotion: current SUPER_ADMINs who are not already in
   * the elevated tier. The elevated tier is drawn from the platform-admin pool,
   * never directly from tenant-level roles.
   */
  async listEligibleUsers(search?: string) {
    const { users } = await this.userRepository.getUsersWithRole(
      UserRole.SUPER_ADMIN,
      search,
    );
    const eligible = [];
    for (const user of users) {
      const roles = await this.groupService.getUserGroupNames(user.id);
      if (!roles.includes(UserRole.SUPER_DUPER_ADMIN)) {
        eligible.push(user);
      }
    }
    return { data: eligible, count: eligible.length };
  }

  async promote(dto: PromoteSuperDuperAdminDto, actingUserId: number) {
    const { userId } = dto;
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.groupService.getUserGroupNames(userId);
    if (roles.includes(UserRole.SUPER_DUPER_ADMIN)) {
      throw new BadRequestException('User is already a super duper admin');
    }
    if (!roles.includes(UserRole.SUPER_ADMIN)) {
      throw new BadRequestException(
        'Only super admins can be promoted to super duper admin',
      );
    }

    // Assign first so the "at least one role" invariant in removeRole can
    // never strand the user roleless.
    await this.groupService.assignRole({
      role: UserRole.SUPER_DUPER_ADMIN,
      userId,
    });
    await this.groupService.removeRole({ role: UserRole.SUPER_ADMIN, userId });

    this.logger.info(
      `User ${userId} (${user.email}) promoted to SUPER_DUPER_ADMIN by user ${actingUserId}`,
    );
    await this.auditLogger.log({
      eventType: 'SUPER_DUPER_ADMIN_PROMOTED',
      userId: actingUserId,
      details: { targetUserId: userId, targetEmail: user.email },
    });

    return { success: true };
  }

  async demote(userId: number, actingUserId: number) {
    if (userId === actingUserId) {
      // Lockout guard: an admin removing their own elevated access must be a
      // deliberate act by a peer, never a self-service click.
      throw new ForbiddenException(
        'You cannot demote yourself from super duper admin',
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.groupService.getUserGroupNames(userId);
    if (!roles.includes(UserRole.SUPER_DUPER_ADMIN)) {
      throw new BadRequestException('User is not a super duper admin');
    }

    const { count } = await this.userRepository.getUsersWithRole(
      UserRole.SUPER_DUPER_ADMIN,
    );
    if (count <= 1) {
      throw new BadRequestException(
        'Cannot demote the last remaining super duper admin',
      );
    }

    // Restore the SUPER_ADMIN tier first (mirrors the promote swap), then drop
    // the elevated role.
    if (!roles.includes(UserRole.SUPER_ADMIN)) {
      await this.groupService.assignRole({
        role: UserRole.SUPER_ADMIN,
        userId,
      });
    }
    await this.groupService.removeRole({
      role: UserRole.SUPER_DUPER_ADMIN,
      userId,
    });

    this.logger.info(
      `User ${userId} (${user.email}) demoted from SUPER_DUPER_ADMIN to SUPER_ADMIN by user ${actingUserId}`,
    );
    await this.auditLogger.log({
      eventType: 'SUPER_DUPER_ADMIN_DEMOTED',
      userId: actingUserId,
      details: { targetUserId: userId, targetEmail: user.email },
    });

    return { success: true };
  }
}
