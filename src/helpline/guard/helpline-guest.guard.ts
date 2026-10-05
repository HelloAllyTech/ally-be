import {
  CanActivate,
  ExecutionContext,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { HelplineTalker } from '../entity/helpline-talker.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineGuestTokenService } from '../service/helpline-guest-token.service';
import { GuestContext } from '../service/helpline-guest.service';
import { HelplineGuestIdentity } from '../type/helpline.types';
import { guestTokenInvalid } from '../util/helpline-errors';

export function bearerToken(header: unknown): string | null {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * Authenticates a talker's guest token (contract §5.2). Never passport's
 * `jwt` strategy: guest routes have no AuthGuard('jwt'), and the guest secret
 * is not the access secret, so neither door accepts the other's key.
 *
 * Every request re-checks the talker row (`revoked_at IS NULL` — erasure and
 * block revoke a token before it expires) and loads the chat by the token's
 * OWN ids, tenant-scoped, so a guest can only ever reach their one chat.
 */
@Injectable()
export class HelplineGuestGuard implements CanActivate {
  constructor(
    private readonly tokens: HelplineGuestTokenService,
    @InjectRepository(HelplineTalker)
    private readonly talkers: Repository<HelplineTalker>,
    private readonly chats: HelplineChatRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const identity = await this.tokens.verify(
      bearerToken(request.headers?.authorization),
    );
    const resolved = await resolveGuest(identity, this.talkers, this.chats);
    if (!resolved) throw guestTokenInvalid();
    ExecutionManager.setAuthContext('', identity.tenantId);
    request.helplineGuest = resolved;
    return true;
  }
}

/** Shared with the socket handshake. null = refuse. */
export async function resolveGuest(
  identity: HelplineGuestIdentity,
  talkers: Repository<HelplineTalker>,
  chats: HelplineChatRepository,
): Promise<GuestContext | null> {
  const talker = await talkers.findOne({
    where: { id: identity.talkerId, tenantId: identity.tenantId },
  });
  if (!talker || talker.revokedAt) return null;
  const chat = await chats.findForGuest(
    identity.tenantId,
    identity.chatId,
    identity.talkerId,
  );
  if (!chat) return null;
  return { chat, talker };
}

export const CurrentGuest = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): GuestContext =>
    ctx.switchToHttp().getRequest().helplineGuest,
);
