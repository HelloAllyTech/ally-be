import {
  BadRequestException,
  Injectable,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../common/entities/user.entity';
import { QueueService } from '../../queue/service/queue.service';
import { Chat, ChatStatus } from '../../common/entities/chat.entity';
import { UserRole, UserStatus } from '../../common/constants/user.constants';
import { RedisService } from '../../redis/service/redis.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { NotFoundException } from 'src/exception/custom.exception';
import { UserFilterOptions } from '../interface/user-filter-options.interface';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserRepository } from '../repository/user.repository';
import { TenantService } from 'src/tenant/service/tenant.service';
import { UserGroup } from 'src/common/entities/user-group.entity';
import { Group } from 'src/common/entities/group.entity';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { GroupService } from 'src/authorization/service/group.service';
import {
  UserDto,
  UserListResponseDto,
  UserUpdateResponseDto,
} from '../dto/user-response.dto';
import { SimulationCreditsService } from 'src/learn/service/simulation-credits.service';
import { AddUserResponseDto } from '../dto/user-add-response.dto';
import { AddUserDto } from '../dto/user-add.dto';
import { UserGroupService } from 'src/authorization/service/user-group.service';

@Injectable()
export class UserService {
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private queueService: QueueService,
    private readonly cache: RedisService,
    @InjectRepository(Group)
    private groupRepository: Repository<Group>,
    @InjectRepository(UserGroup)
    private userGroupRepository: Repository<UserGroup>,
    private readonly tenantService: TenantService,
    private readonly usersRepository: UserRepository,
    private readonly groupService: GroupService,
    @Inject(forwardRef(() => SimulationCreditsService))
    private readonly simulationCreditsService: SimulationCreditsService,
    private readonly usersGroupService: UserGroupService,
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

  async getUserByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const cachedUser = await this.cache.get(`user_${phoneNumber}`);
    if (cachedUser) {
      return JSON.parse(cachedUser);
    }
    const user = await this.userRepository.findOne({
      where: { phone: phoneNumber },
    });
    if (user) {
      await this.cache.set(`user_${phoneNumber}`, JSON.stringify(user));
      return user;
    }
    return null;
  }

  async getUsersByPhoneNumbers(phoneNumbers: string[]): Promise<User[] | null> {
    return this.userRepository.find({
      where: {
        phone: In(phoneNumbers),
        tenantId: ExecutionManager.getTenantId(),
      },
    });
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
    const data = await this.userRepository
      .createQueryBuilder('user')
      .where('user.id IN (:...clientIds)', { clientIds: Array.from(clientIds) })
      .andWhere('user.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
      .leftJoinAndMapMany(
        'user.chat',
        Chat,
        'chat',
        `chat.clientId = user.id and chat.status = '${ChatStatus.PAUSED}'`,
      )
      .andWhere('chat.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
      .getMany();
    const formattedData = data.map((user: any) => {
      const chat = user.chat?.[0] as Chat;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        chat: chat
          ? {
              chatId: chat.id,
              roomId: chat.roomId,
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
    };
  }

  async createUser({
    phoneNumber,
    name,
    email,
    status,
    username,
    tenantId,
  }: {
    phoneNumber: string;
    name?: string;
    email?: string;
    status?: UserStatus;
    username?: string;
    tenantId?: string;
  }) {
    // TODO: Add phone number to the user table and update this query
    const user = this.userRepository.create({
      phone: phoneNumber,
      name: name || 'Anonymous user',
      email: email || `${phoneNumber}@placeholder.com`,
      status: status || UserStatus.ACTIVE,
      username: username || `${phoneNumber}_user`,
      tenantId: tenantId || 'anonyumous_tenant',
    });
    return this.userRepository.save(user);
  }

  async getCounselorNames(limit?: number, offset?: number, search?: string) {
    const query = this.userRepository
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .addSelect('user.name', 'name')
      .andWhere('user.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
      .leftJoin(UserGroup, 'userGroup', 'userGroup.userId = user.id')
      .leftJoin(Group, 'group', 'group.id = userGroup.groupId')
      .andWhere('group.name = :role', { role: UserRole.COUNSELOR })
      .orderBy('user.id', 'ASC');

    if (search && search.trim()) {
      query.andWhere('user.name ILIKE :search', {
        search: `%${search.trim()}%`,
      });
    }

    if (limit) {
      query.limit(limit);
    }
    if (offset) {
      query.offset(offset);
    }

    const counselors = await query.getRawMany();
    const count = await query.getCount();

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
    const result = await this.usersRepository.getAllUsers(filters, true);
    if (result.users.length === 0) {
      return { data: [], count: 0 };
    }
    const userIds = result.users.map((u) => u.user_id);

    const roles = await this.usersGroupService.findUserRoles(userIds);

    const rolesMap = new Map(roles.map((r) => [r.userId, r.roles]));

    const transformedUsers: UserDto[] = result.users.map((user) => ({
      id: user.user_id,
      name: user.user_name,
      email: user.user_email,
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
    const updated = await this.userRepository.update(id, body as Partial<User>);

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

    user.status = newStatus;
    await this.userRepository.save(user);

    return { success: true };
  }

  async addUser(userData: AddUserDto): Promise<AddUserResponseDto> {
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

    if (!userData.tenantId) {
      throw new BadRequestException('Tenant ID is required');
    } else {
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
      status: userData.status || UserStatus.ACTIVE,
      metadata: {},
      username: userData.username || userData.email,
      phone: userData.phone,
      tenantId: userData.tenantId,
      externalId: userData.externalId,
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
      eventType: AUDIT_EVENTS.USER_SIGNUP,
      tenantId: savedUser.tenantId,
      userId: savedUser.id,
      details: {
        username: savedUser.username,
        email: savedUser.email,
        phone: savedUser.phone,
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
}
