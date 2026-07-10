import {
  BadRequestException,
  Injectable,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../entity/user.entity';
import { QueueService } from '../../queue/service/queue.service';
import { Chat } from '../../chat/entity/chat.entity';
import {
  UserRole,
  SUPER_ADMIN_ROLES,
} from '../../common/constants/user.constants';
import { UserStatus } from '../constants/user-status.constants';
import { RedisService } from '../../redis/service/redis.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { NotFoundException } from 'src/exception/custom.exception';
import {
  MinimalTenantData,
  UserFilterOptions,
} from '../interface/user-filter-options.interface';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserRepository } from '../repository/user.repository';
import { TenantService } from '../../tenant/service/tenant.service';
import { Group } from 'src/authorization/entity/group.entity';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { GroupService } from 'src/authorization/service/group.service';
import {
  UserDto,
  UserListResponseDto,
  UserUpdateResponseDto,
} from '../dto/user-response.dto';
import { SimulationCreditsService } from '../../learn/service/simulation-credits.service';
import { AddUserResponseDto } from '../dto/user-add-response.dto';
import { UserGroupService } from '../../authorization/service/user-group.service';
import { AddUserDto } from '../dto/add-user.dto';
import { BulkAddUsersDto } from '../dto/bulk-add-user.dto';
import { BulkAddUsersResponseDto } from '../dto/bulk-add-user-response.dto';
import { CompleteProfileDto } from '../dto/complete-profile.dto';
import { UserGroup } from 'src/authorization/entity/user-group.entity';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { UserGroupRepository } from 'src/authorization/repository/user-group.repository';
import { SuccessResponse } from 'src/common/type/common.type';
import { UserPreferencesRepository } from '../repository/user-prefernces.repository';
import { UpdateUserPreferencesDto } from '../dto/update-user-prefernces.dto';
import {
  ProfileImageUploadRequestDto,
  ProfileImageUploadResponseDto,
} from '../dto/profile-image-upload-request.dto';
import { ProfileImageUploadContentType } from '../enum/user.enum';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { DeleteProfileImageDto } from '../dto/delete-profile-image.dto';
import { LoggerService } from 'src/logger/logger.service';
import { ProfileImageUploadDto } from '../dto/profile-image-upload.dto';
import { AdminTenantService } from './admin-tenant.service';
import { PermissionsService } from '../../authorization/service/permissions.service';

@Injectable()
export class UserService {
  private readonly auditLogger = AuditLoggerService.getInstance();
  private readonly logger = LoggerService.getInstance(UserService.name);

  constructor(
    private queueService: QueueService,
    private readonly cache: RedisService,
    private groupRepository: GroupRepository,
    private userGroupRepository: UserGroupRepository,
    private userPreferencesRepository: UserPreferencesRepository,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
    private readonly userRepository: UserRepository,
    private readonly groupService: GroupService,
    @Inject(forwardRef(() => SimulationCreditsService))
    private readonly simulationCreditsService: SimulationCreditsService,
    private readonly usersGroupService: UserGroupService,
    private configService: AppConfigService,
    private s3Service: S3Service,
    private permissionsService: PermissionsService,
    private readonly adminTenantService: AdminTenantService,
    private readonly dataSource: DataSource,
  ) {}

  async get(id: number): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId: ExecutionManager.getTenantId() },
    });
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_PROFILE_ACCESS,
    });
    return user || null;
  }

  async getTermsAndAgreementStatus(): Promise<SuccessResponse> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }
    const user = await this.get(Number(userId));
    return { success: user?.termsAndAgreementApproved || false };
  }

  async approveTermsAndAgreement(): Promise<SuccessResponse> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }

    const user = await this.get(Number(userId));
    if (!user) {
      throw new BadRequestException('User not found');
    }

    await this.userRepository.update(user.id, {
      termsAndAgreementApproved: true,
      termsAndAgreementApprovedAt: new Date(),
    });

    await this.cache.set(`user:terms:${userId}`, 'true', 1800);

    return { success: true };
  }

  async getUsersByIds(ids: number[]): Promise<User[]> {
    return this.userRepository.find({
      where: {
        id: In(ids),
        tenantId: ExecutionManager.getTenantId(),
      },
    });
  }

  async getWaitingList() {
    const waitingClients = await this.queueService.getWaitingClients();
    const clientIds = new Set(waitingClients.map((queue) => queue.clientId));
    if (!clientIds.size) return { total_waiting: clientIds.size, clients: [] };
    const data = await this.userRepository.getWaitingList(
      Array.from(clientIds).map((id) => id.toString()),
    );
    const formattedData = data.map((user: any) => {
      const chat = user.chat?.[0] as Chat;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        chat: chat
          ? {
              chatId: chat.id,
              clientId: chat.clientId,
              counselorId: chat.counselorId,
              status: chat.status,
              startedAt: chat.startedAt,
              endedAt: chat.endedAt,
            }
          : [],
      };
    });
    return { totalWaiting: clientIds.size, clients: formattedData };
  }

  async getMinimalUserInfo(user: User | null) {
    if (!user) return null;
    // TO DO : Remove the role field from the api once mobile forceupdate is done after permissions integration
    const roles = await this.groupService.getUserRolesByUserId(user.id);
    const role = this.determineUserRole(roles);
    return {
      id: user.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role,
      tenantId: user.tenantId,
      phone: user.phone,
      status: user.status,
      profileImageUrl: user.profileImageUrl,
      profileCompleted: user.profileCompleted,
    };
  }

  async getCounselorNames(limit?: number, offset?: number, search?: string) {
    const { counselors, count } = await this.userRepository.getCounselorNames(
      limit,
      offset,
      search,
    );

    return {
      data: counselors.map((counselor: any) => ({
        id: parseInt(counselor.id),
        name: counselor.name,
      })),
      count,
    };
  }

  async getUserByExternalId(externalId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { externalId, tenantId: ExecutionManager.getTenantId() },
    });
  }

  async getAllUsers(filters: UserFilterOptions): Promise<UserListResponseDto> {
    const userId = ExecutionManager.getUserId();

    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(Number(userId))
      : false;

    if (isMultiTenantAdmin) {
      const adminTenants = await this.adminTenantService.getTenantsForAdmin(
        Number(userId),
      );

      const mappedTenantIds = adminTenants.data.map((t: any) => t.id);

      if (filters.tenantIds) {
        const requestedTenantIds = filters.tenantIds
          .split(',')
          .map((id) => id.trim());

        const allowedTenantIds = requestedTenantIds.filter((id) =>
          mappedTenantIds.includes(id),
        );

        filters.tenantIds =
          allowedTenantIds.length > 0
            ? allowedTenantIds.join(',')
            : '00000000-0000-0000-0000-000000000000';
      } else {
        filters.tenantIds =
          mappedTenantIds.length > 0
            ? mappedTenantIds.join(',')
            : '00000000-0000-0000-0000-000000000000';
      }
    }

    const result = await this.userRepository.getAllUsers(filters, true);
    if (result.users.length === 0) {
      return { data: [], count: 0 };
    }
    const userIds = result.users.map((u) => u.user_id);

    const roles = await this.usersGroupService.getUserGroupsByUserIds(userIds);

    const rolesMap = new Map(roles.map((r) => [r.userId, r.roles]));

    const transformedUsers: UserDto[] = result.users.map((user) => ({
      id: user.user_id,
      name: user.user_name,
      email: user.user_email,
      profileImageUrl: user.user_profileImageUrl,
      username: user.user_username,
      externalId: user.user_externalId,
      status: user.user_status,
      role: user.user_role,
      metadata: user.user_metadata,
      organization: user.tenant_name,
      tenantId: user.user_tenant_id,
      createdAt: user.user_createdAt,
      updatedAt: user.user_updatedAt,
      roles: rolesMap.get(user.user_id) || [],
      creditLimit: user.simulation_credit_limit,
      consumedCredits: user.simulation_consumed_credits,
    }));

    return { data: transformedUsers, count: result.count };
  }

  async updateUser(
    id: number,
    body: UpdateUserDto,
  ): Promise<UserUpdateResponseDto> {
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(userId)
      : false;

    if (isMultiTenantAdmin) {
      throw new BadRequestException('User is not authorized to update user');
    }

    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    if (body.email && body.email !== user.email) {
      // Email is different from current - check uniqueness
      const existingUser = await this.userRepository.findOne({
        where: {
          email: body.email,
          id: Not(id),
        },
      });

      if (existingUser) {
        throw new BadRequestException(
          `Email ${body.email} is already in use by another user`,
        );
      }
    }
    if (body.externalId && body.externalId !== user.externalId) {
      const existingUserWithExternalId = await this.userRepository.findOne({
        where: {
          tenantId: user.tenantId,
          externalId: body.externalId,
          id: Not(id), // Exclude current user
        },
      });

      if (existingUserWithExternalId) {
        throw new BadRequestException(
          `External ID ${body.externalId} is already in use by another user in this tenant`,
        );
      }
    }

    const updatedUserData = {
      ...body,
      ...(userId ? { updatedBy: userId } : {}),
    };

    const updated = await this.userRepository.update(
      id,
      updatedUserData as Partial<User>,
    );

    const updatedUser = await this.userRepository.findOne({ where: { id } });
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_UPDATED,
      tenantId: updatedUser?.tenantId,
      userId: user.id,
      details: {
        username: updatedUser?.username,
        email: updatedUser?.email,
        phone: updatedUser?.phone,
        updatedBy: userId,
      },
    });

    return { success: updated.affected !== 0 };
  }

  async updateUserStatus(
    id: number,
    newStatus: UserStatus,
  ): Promise<UserUpdateResponseDto> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (user.status === newStatus) {
      throw new BadRequestException(
        `User with ID ${id} is already ${newStatus.toLowerCase()}`,
      );
    }
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;
    const updatedUserData = {
      status: newStatus,
      ...(userId ? { updatedBy: userId } : {}),
      ...(newStatus === UserStatus.SUSPENDED && userId
        ? { suspendedBy: userId, suspendedAt: new Date() }
        : {}),
    };
    await this.userRepository.update(id, updatedUserData as Partial<User>);
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_UPDATED,
      tenantId: user.tenantId,
      userId: user.id,
      details: {
        message: 'User status updated',
        status: newStatus,
        updatedBy: userId,
      },
    });
    return { success: true };
  }

  async addUser(userData: AddUserDto): Promise<AddUserResponseDto> {
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    // Check if user with email or phone already exists
    const existingUser = await this.userRepository.findOne({
      where: [{ email: userData.email }, { phone: userData.phone }],
      select: ['email', 'phone'],
    });

    if (existingUser) {
      if (existingUser.email === userData.email) {
        throw new BadRequestException('Email already registered');
      }
      throw new BadRequestException('Phone number already registered');
    }

    const isSuperAdmin = userData.roles.some((role) =>
      SUPER_ADMIN_ROLES.includes(role),
    );
    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(Number(userId))
      : false;

    if (isMultiTenantAdmin) {
      throw new BadRequestException('User is not authorized to add user');
    }

    if (!userData.tenantId) {
      throw new BadRequestException('Tenant ID is required');
    } else if (!isSuperAdmin) {
      const tenant = await this.tenantService.findById(userData.tenantId);
      if (!tenant) {
        throw new BadRequestException(' Tenant is not valid');
      }
    }
    if (userData.externalId) {
      const existingExternalId = await this.userRepository.findOne({
        where: {
          tenantId: userData.tenantId,
          externalId: userData.externalId,
        },
      });

      if (existingExternalId) {
        throw new BadRequestException(
          `External ID ${userData.externalId} is already in use by another user in this organization`,
        );
      }
    }

    // Hash password
    const hashedPassword = userData.password
      ? await bcrypt.hash(userData.password, 10)
      : undefined;

    const newUser = this.userRepository.create({
      email: userData.email,
      password: hashedPassword,
      name: userData.name,
      status: UserStatus.ACTIVE,
      metadata: {},
      username: userData.username || userData.email,
      phone: userData.phone,
      tenantId: userData.tenantId,
      externalId: userData.externalId,
      ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
    });

    // Save user
    const savedUser = await this.userRepository.save(newUser);

    const groups = await this.groupRepository.find({
      where: { name: In(userData.roles) },
    });

    if (groups.length > 0) {
      // Add user to default group
      const groupsData = groups.map((group) =>
        this.userGroupRepository.create({
          userId: savedUser.id,
          groupId: group.id,
        }),
      );
      await this.userGroupRepository.save(groupsData);
    }
    if (userData.simulationCreditLimit) {
      await this.simulationCreditsService.updateSimulationCredits({
        userId: savedUser.id,
        creditLimit: userData.simulationCreditLimit,
      });
    }

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_CREATED,
      tenantId: savedUser.tenantId,
      userId: savedUser.id,
      details: {
        username: savedUser.username,
        email: savedUser.email,
        phone: savedUser.phone,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    return {
      id: savedUser.id,
      name: savedUser.name,
      email: savedUser.email,
      username: savedUser.username,
      phone: savedUser.phone,
      externalId: savedUser.externalId,
      status: savedUser.status,
      metadata: savedUser.metadata,
      tenantId: savedUser.tenantId,
      createdAt: savedUser.createdAt,
      updatedAt: savedUser.updatedAt,
    };
  }

  /**
   * Bulk-create users from a list of emails plus common settings (roles, tenant,
   * credit limit). Each user is created with no name and profileCompleted=false
   * so they are prompted to finish their profile on first login.
   *
   * All-or-nothing: every email is validated (format via the DTO, no duplicates
   * within the batch, none already registered) before anything is written, and
   * user + group creation runs inside a single transaction so any failure rolls
   * the whole batch back.
   */
  async bulkAddUsers(
    bulkData: BulkAddUsersDto,
  ): Promise<BulkAddUsersResponseDto> {
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(Number(userId))
      : false;
    if (isMultiTenantAdmin) {
      throw new BadRequestException('User is not authorized to add user');
    }

    // Normalise + dedupe emails within the batch.
    const normalisedEmails = bulkData.emails.map((email) =>
      email.trim().toLowerCase(),
    );
    const uniqueEmails = Array.from(new Set(normalisedEmails));
    if (uniqueEmails.length !== normalisedEmails.length) {
      const duplicates = Array.from(
        new Set(
          normalisedEmails.filter(
            (email, index) => normalisedEmails.indexOf(email) !== index,
          ),
        ),
      );
      throw new BadRequestException(
        `Duplicate emails in request: ${duplicates.join(', ')}`,
      );
    }

    if (!bulkData.tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const isSuperAdmin = bulkData.roles.some((role) =>
      SUPER_ADMIN_ROLES.includes(role),
    );
    if (!isSuperAdmin) {
      const tenant = await this.tenantService.findById(bulkData.tenantId);
      if (!tenant) {
        throw new BadRequestException('Tenant is not valid');
      }
    }

    // Reject the whole batch if any email already belongs to an account.
    const existingUsers = await this.userRepository.find({
      where: { email: In(uniqueEmails) },
      select: ['email'],
    });
    if (existingUsers.length > 0) {
      const taken = existingUsers.map((user) => user.email);
      throw new BadRequestException(
        `These emails are already registered: ${taken.join(', ')}`,
      );
    }

    const groups = await this.groupRepository.find({
      where: { name: In(bulkData.roles) },
    });

    // Create users + group memberships atomically.
    const savedUsers = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const userGroupRepo = manager.getRepository(UserGroup);

      const created: User[] = [];
      for (const email of uniqueEmails) {
        const newUser = userRepo.create({
          email,
          // Blank until the user completes their profile on first login.
          name: '',
          status: UserStatus.ACTIVE,
          profileCompleted: false,
          metadata: {},
          username: email,
          tenantId: bulkData.tenantId,
          ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
        });
        const savedUser = await userRepo.save(newUser);

        if (groups.length > 0) {
          const groupsData = groups.map((group) =>
            userGroupRepo.create({
              userId: savedUser.id,
              groupId: group.id,
            }),
          );
          await userGroupRepo.save(groupsData);
        }
        created.push(savedUser);
      }
      return created;
    });

    // Simulation credits are applied after commit (their service validates
    // role permissions against committed group rows), mirroring addUser.
    if (bulkData.simulationCreditLimit) {
      for (const savedUser of savedUsers) {
        await this.simulationCreditsService.updateSimulationCredits({
          userId: savedUser.id,
          creditLimit: bulkData.simulationCreditLimit,
        });
      }
    }

    for (const savedUser of savedUsers) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.USER_CREATED,
        tenantId: savedUser.tenantId,
        userId: savedUser.id,
        details: {
          username: savedUser.username,
          email: savedUser.email,
          createdBy: userId,
          updatedBy: userId,
          bulk: true,
        },
      });
    }

    return {
      created: savedUsers.length,
      users: savedUsers.map((savedUser) => ({
        id: savedUser.id,
        name: savedUser.name,
        email: savedUser.email,
        username: savedUser.username,
        phone: savedUser.phone,
        externalId: savedUser.externalId,
        status: savedUser.status,
        metadata: savedUser.metadata,
        tenantId: savedUser.tenantId,
        createdAt: savedUser.createdAt,
        updatedAt: savedUser.updatedAt,
      })),
    };
  }

  /**
   * Self-serve completion of an incomplete profile (typically the first login
   * of a bulk-created account). Fills in the name (and optionally phone) and
   * flips profileCompleted so clients stop gating the user.
   */
  async completeProfile(
    userId: number,
    dto: CompleteProfileDto,
  ): Promise<SuccessResponse> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (dto.phone && dto.phone !== user.phone) {
      const existingPhone = await this.userRepository.findOne({
        where: { phone: dto.phone, id: Not(userId) },
      });
      if (existingPhone) {
        throw new BadRequestException('Phone number already registered');
      }
    }

    await this.userRepository.update(userId, {
      name: dto.name,
      ...(dto.phone ? { phone: dto.phone } : {}),
      profileCompleted: true,
      updatedBy: userId,
    });

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_UPDATED,
      tenantId: user.tenantId,
      userId: user.id,
      details: {
        message: 'Profile completed',
        updatedBy: userId,
      },
    });

    return { success: true };
  }

  /**
   * Determines the user role based on available roles
   * Priority: ADMIN > COUNSELOR > first available role
   */
  private determineUserRole(roles: Group[]): string {
    if (roles.some((role) => role.name === UserRole.ADMIN)) {
      return UserRole.ADMIN;
    }

    if (roles.some((role) => role.name === UserRole.COUNSELOR)) {
      return UserRole.COUNSELOR;
    }

    // Return the first available role if neither ADMIN nor COUNSELOR
    return roles[0].name;
  }

  async isValidUser(id: number): Promise<boolean> {
    return this.userRepository.exists({ where: { id } });
  }

  async updateUserPreferences(
    userId: number,
    tenantId: string,
    updateUserPreferencesDto: UpdateUserPreferencesDto,
  ): Promise<UserUpdateResponseDto> {
    await this.userPreferencesRepository.upsertUserPreferences(
      userId,
      tenantId,
      updateUserPreferencesDto,
    );

    return { success: true };
  }

  async getUserPreferences(userId: number): Promise<any> {
    return this.userPreferencesRepository.getUserPreferencesByUserId(userId);
  }

  async getUserTenant(): Promise<MinimalTenantData> {
    const userId = ExecutionManager.getUserId();

    if (!userId) {
      throw new BadRequestException('Unauthorized access');
    }
    const user = await this.userRepository.findOne({
      where: { id: Number(userId) },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    const tenant = await this.tenantService.findById(user.tenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${user.tenantId} not found`);
    }

    return { name: tenant.name, logoUrl: tenant.logoUrl };
  }
  async getPresignedUrlForProfileImage(
    profileImageUploadRequestDto: ProfileImageUploadRequestDto,
  ): Promise<ProfileImageUploadResponseDto> {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new Error('S3 bucket name for assetsBucket is not defined');
    }

    const { fileName, fileSize, contentType } = profileImageUploadRequestDto;

    if (!Object.values(ProfileImageUploadContentType).includes(contentType)) {
      throw new BadRequestException('Invalid file type');
    }

    const maxFileSize = 2 * 1024 * 1024; // 2 MB
    if (fileSize > maxFileSize) {
      throw new BadRequestException(
        `File size must be less than ${maxFileSize / 1024 / 1024} MB`,
      );
    }

    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }
    const uuid = uuidv4();
    const sanitizedFileName = this.s3Service.sanitizeFileName(fileName);

    const storageKey = `profiles/${userId}-${uuid}-${sanitizedFileName}`;
    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket,
      key: storageKey,
      operation: 'put',
      expiresIn: 600, // 10 minutes
      contentType,
    });

    const region = this.configService.aws.region;
    const profileImageUrl = `https://${bucket}.s3.${region}.amazonaws.com/${storageKey}`;

    return { presignedUrl, profileImageUrl };
  }

  async deleteProfileImage(deleteProfileImageDto: DeleteProfileImageDto) {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new Error('S3 bucket name for assets is not defined');
    }
    const profileImageUrl = deleteProfileImageDto.profileImageUrl;
    const s3ProfileImageUrlPattern =
      /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;
    const profileImageUrlMatch = profileImageUrl.match(
      s3ProfileImageUrlPattern,
    );
    const storageKey = profileImageUrlMatch ? profileImageUrlMatch[1] : null;
    if (!storageKey) {
      this.logger.warn(`Invalid or unrecognized S3 URL: ${profileImageUrl}`);
      return { success: false };
    }
    try {
      await this.s3Service.deleteObject({
        bucket,
        key: storageKey,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to delete uploaded profileImage with error ${JSON.stringify(
          error,
        )}`,
      );
      return { success: false };
    }
  }

  async uploadProfileImage(
    profileImageUploadDto: ProfileImageUploadDto,
  ): Promise<SuccessResponse> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }
    const user = await this.userRepository.findOne({
      where: { id: Number(userId) },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    const updatedUser = this.userRepository.create({
      ...user,
      profileImageUrl: profileImageUploadDto?.profileImageUrl,
    });
    await this.userRepository.save(updatedUser);
    return { success: true };
  }
}
