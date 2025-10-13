import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../common/entities/user.entity';
import { QueueService } from '../queue/service/queue.service';
import { Chat, ChatStatus } from '../common/entities/chat.entity';
import { UserRole, UserStatus } from '../common/constants/user.constants';
import { RedisService } from '../redis/service/redis.service';
import { ExecutionManager } from '../common/execution/execution-manager';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';

@Injectable()
export class UserService {
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private queueService: QueueService,
    private readonly cache: RedisService,
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
        role: user.role,
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

  getMinimalUserInfo(user: User | null) {
    if (!user) return null;
    return {
      id: user.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      phone: user.phone,
    };
  }

  async createUser({
    role,
    phoneNumber,
    name,
    email,
    status,
    username,
    tenantId,
  }: {
    phoneNumber: string;
    role: UserRole;
    name?: string;
    email?: string;
    status?: UserStatus;
    username?: string;
    tenantId?: string;
  }) {
    // TODO: Add phone number to the user table and update this query
    const user = this.userRepository.create({
      role,
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
      .where('user.role = :role', { role: UserRole.COUNSELOR })
      .andWhere('user.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
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
}
