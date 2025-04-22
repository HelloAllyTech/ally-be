import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../common/entities/user.entity';
import { QueueService } from '../queue/service/queue.service';
import { Chat, ChatStatus } from '../common/entities/chat.entity';
import { UserRole } from '../common/constants/user.constants';
import { RedisService } from '../redis/service/redis.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private queueService: QueueService,
    private readonly cache: RedisService,
  ) {}

  async get(id: number): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { id },
    });
    return user || null;
  }

  async getUsersByIds(ids: number[]): Promise<User[]> {
    return this.userRepository.find({
      where: {
        id: In(ids),
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
      .leftJoinAndMapMany(
        'user.chat',
        Chat,
        'chat',
        `chat.clientId = user.id and chat.status = '${ChatStatus.PAUSED}'`,
      )
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
    };
  }

  async getUserRole(id: number): Promise<UserRole | undefined> {
    const cachedUserRole = await this.cache.get(`user_role_${id}`);
    if (cachedUserRole) return cachedUserRole as UserRole;
    const user = await this.userRepository.findOne({
      where: { id },
    });
    const userRole = user?.role;
    if (userRole) await this.cache.set(`user_role_${id}`, userRole);
    return userRole;
  }
}
