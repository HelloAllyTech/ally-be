import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { PreferenceName } from 'src/common/constants/user.constants';
import { LoggerService } from 'src/logger/logger.service';
import { HelplineTalker } from '../entity/helpline-talker.entity';
import { resolveGuest } from '../guard/helpline-guest.guard';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineContentCipher } from '../service/helpline-content-cipher.service';
import { HelplineGuestTokenService } from '../service/helpline-guest-token.service';
import { HelplineTenantService } from '../service/helpline-tenant.service';

export type HelplineSocketData =
  | {
      kind: 'talker';
      talkerId: string;
      chatId: string;
      tenantId: string;
      talkerName: string;
    }
  | {
      kind: 'staff';
      userId: number;
      tenantId: string;
      permissions: string[];
    };

export function extractSocketToken(socket: Socket): string | null {
  const auth = socket.handshake?.auth?.token;
  if (typeof auth === 'string' && auth) return auth;
  const query = socket.handshake?.query?.token;
  if (typeof query === 'string' && query) return query;
  const header = socket.handshake?.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length) || null;
  }
  return null;
}

/**
 * The `/helpline-chat` handshake (contract §6.1). One namespace, two kinds of
 * caller, routed by the token's claimed audience and then VERIFIED with the
 * matching secret — so claiming the wrong audience only gets a token checked
 * against a key it was not signed with.
 *
 *  - guest: guest secret + `aud`, talker not revoked, chat exists
 *  - staff: the existing user-JWT verification (WebSocketAuthMiddleware, with
 *    no permission list), then `view:helpline:lobby` OR `view:helpline:monitor`,
 *    then the tenant gate (invariant 4)
 *
 * Any failure is `next(new Error('unauthorized'))` — the client learns nothing
 * about which check failed.
 */
@Injectable()
export class HelplineSocketAuthService {
  private readonly logger = LoggerService.getInstance(
    HelplineSocketAuthService.name,
  );

  constructor(
    private readonly tokens: HelplineGuestTokenService,
    private readonly wsAuth: WebSocketAuthMiddleware,
    private readonly permissions: PermissionsService,
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly tenants: HelplineTenantService,
    @InjectRepository(HelplineTalker)
    private readonly talkers: Repository<HelplineTalker>,
    private readonly chats: HelplineChatRepository,
    private readonly cipher: HelplineContentCipher,
  ) {}

  middleware() {
    return async (socket: Socket, next: (err?: Error) => void) => {
      try {
        socket.data.helpline = await this.authenticate(socket);
        next();
      } catch (error) {
        this.logger.warn(
          `Helpline socket ${socket.id} refused: ${(error as Error)?.message ?? 'unknown'}`,
        );
        next(new Error('unauthorized'));
      }
    };
  }

  async authenticate(socket: Socket): Promise<HelplineSocketData> {
    const token = extractSocketToken(socket);
    if (!token) throw new Error('no token');

    if (this.tokens.looksLikeGuestToken(token)) {
      const identity = await this.tokens.verify(token);
      const guest = await resolveGuest(
        identity,
        this.talkers,
        this.chats,
        this.cipher,
      );
      if (!guest) throw new Error('guest revoked or chat missing');
      return {
        kind: 'talker',
        talkerId: identity.talkerId,
        chatId: identity.chatId,
        tenantId: identity.tenantId,
        talkerName: guest.talker.displayName,
      };
    }

    await new Promise<void>((resolve, reject) =>
      this.wsAuth.webSocketMiddleware([])(socket, (err?: Error) =>
        err ? reject(err) : resolve(),
      ),
    );
    const user = socket.data.user as
      | { id: number; tenantId?: string }
      | undefined;
    if (!user?.id) throw new Error('no user');

    const permissions = await this.permissions.getUserPermissions(user.id);
    if (
      !permissions.includes(PERMISSIONS.VIEW_HELPLINE_LOBBY) &&
      !permissions.includes(PERMISSIONS.VIEW_HELPLINE_MONITOR)
    ) {
      throw new Error(`user ${user.id} has no helpline permission`);
    }
    const enabled = await this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      user.tenantId,
    );
    if (!enabled) throw new Error('helpline disabled for tenant');
    const tenant = await this.tenants.resolve(user.tenantId);
    if (!tenant) throw new Error('unknown tenant');

    return { kind: 'staff', userId: user.id, tenantId: tenant.id, permissions };
  }
}
