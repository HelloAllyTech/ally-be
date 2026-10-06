import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { PreferenceName } from 'src/common/constants/user.constants';
import { ErrorCode } from 'src/exception/error-code.enum';
import { FAILURE_MESSAGES } from 'src/exception/failure-messages';
import { HelplineChatStatus } from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineTenantService } from '../service/helpline-tenant.service';
import { HelplineTenant } from '../type/helpline.types';
import { helplineDisabled } from '../util/helpline-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long after a chat ends its listener keeps the chat-scoped routes while
 * the helpline is switched off — long enough to read it back and save the
 * summary the end flow asks for, no longer.
 */
export const HELPLINE_DISABLED_GRACE_MS = 60 * 60 * 1000;

/**
 * With the helpline switched off, may this user keep working on this chat?
 * Only its listener of record, only while it is ACTIVE (or for the grace
 * period after it ended). Pure, so the rule is tested rather than trusted.
 */
export function listenerMayContinue(
  chat: Pick<HelplineChat, 'listenerId' | 'status' | 'endedAt'> | null,
  userId: number,
  now: Date = new Date(),
): boolean {
  if (!chat || chat.listenerId == null || chat.listenerId !== userId) {
    return false;
  }
  if (chat.status === HelplineChatStatus.ACTIVE) return true;
  if (chat.status === HelplineChatStatus.ENDED && chat.endedAt) {
    return (
      now.getTime() - new Date(chat.endedAt).getTime() <=
      HELPLINE_DISABLED_GRACE_MS
    );
  }
  return false;
}

function requireUser(request: { user?: { id: number; tenantId: string } }) {
  const user = request.user;
  if (!user) {
    throw new UnauthorizedException({
      message: FAILURE_MESSAGES.UNAUTHENTICATED,
      error: 'Unauthorized',
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: ErrorCode.UNAUTHENTICATED,
    });
  }
  return user;
}

/**
 * Invariant 4, "fail closed on the gate": the caller's tenant must have
 * TEXT_HELPLINE_ENABLED, on top of whatever permission the route asks for.
 *
 * Composes with `@AuthPermissions` and must sit ABOVE it: guard decorators
 * apply bottom-up, so the lower decorator's guards run first, and this guard
 * needs the `request.user` that AuthGuard('jwt') sets. Written the other way
 * round, every request answers 401 — loud, and pinned by
 * `helpline-controller-guards.spec.ts`.
 *
 * Reads TenantFeatureService, the raw-DataSource reader the global auth
 * module already exposes; it deliberately does NOT inject any settings-module
 * provider (that is a known boot-breaking DI cycle).
 *
 * On success it also resolves the tenant and leaves it on the request for
 * `@HelplineTenantParam()`, so no handler resolves it twice.
 */
@Injectable()
export class HelplineEnabledGuard implements CanActivate {
  constructor(
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly tenantService: HelplineTenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = requireUser(request);
    const enabled = await this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      user.tenantId,
    );
    if (!enabled) throw helplineDisabled();
    const tenant = await this.tenantService.resolve(user.tenantId);
    if (!tenant) throw helplineDisabled();
    request.helplineTenant = tenant;
    return true;
  }
}

/**
 * The chat-scoped variant (`:id` = chat id): exactly HelplineEnabledGuard while
 * the helpline is on. While it is OFF it still lets the chat's listener of
 * record through for that one chat — read it, send, end it, acknowledge a
 * flag, alert a supervisor, save the summary — so switching the org off never
 * cuts a listener off mid-conversation with a person in distress. Everyone
 * else, and every other chat, gets HELPLINE_DISABLED as before (invariant 4
 * still fails closed for new work: no lobby, claim, presence, monitor).
 *
 * The chat is loaded with the caller's tenant in the WHERE clause, so this
 * cannot widen access across tenants; the route's own permission and the
 * service's per-chat access rule still apply on top.
 */
@Injectable()
export class HelplineChatScopedGuard implements CanActivate {
  constructor(
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly tenantService: HelplineTenantService,
    private readonly chats: HelplineChatRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = requireUser(request);
    const enabled = await this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      user.tenantId,
    );
    const tenant = await this.tenantService.resolve(user.tenantId);
    if (!tenant) throw helplineDisabled();
    if (!enabled) {
      const chatId = request.params?.id;
      if (typeof chatId !== 'string' || !UUID.test(chatId)) {
        throw helplineDisabled();
      }
      const chat = await this.chats.findById(tenant.id, chatId);
      if (!listenerMayContinue(chat, user.id)) throw helplineDisabled();
    }
    request.helplineTenant = tenant;
    return true;
  }
}

/**
 * For `GET me` only: exactly HelplineEnabledGuard while the helpline is on.
 * While it is OFF, a listener who is still the listener of record of an
 * ACTIVE chat passes, so the chat view keeps the org's escalation checklist,
 * support contact and summary fields for the conversation they are finishing.
 * Profile and presence writes stay on the plain gate (going Available is new
 * work).
 */
@Injectable()
export class HelplineEnabledOrContinuingGuard implements CanActivate {
  constructor(
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly tenantService: HelplineTenantService,
    private readonly chats: HelplineChatRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = requireUser(request);
    const enabled = await this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      user.tenantId,
    );
    const tenant = await this.tenantService.resolve(user.tenantId);
    if (!tenant) throw helplineDisabled();
    if (!enabled) {
      const active = await this.chats.listActiveForListener(tenant.id, user.id);
      if (active.length === 0) throw helplineDisabled();
    }
    request.helplineTenant = tenant;
    return true;
  }
}

/** Place ABOVE `@AuthPermissions(...)` (see HelplineEnabledGuard). */
export const RequireHelplineEnabled = () =>
  applyDecorators(UseGuards(HelplineEnabledGuard));

/**
 * For `chats/:id/...` routes the listener of record must keep while the
 * helpline is switched off. Place ABOVE `@AuthPermissions(...)`.
 */
export const RequireHelplineEnabledForChat = () =>
  applyDecorators(UseGuards(HelplineChatScopedGuard));

/** For `GET me` (see HelplineEnabledOrContinuingGuard). Place ABOVE `@AuthPermissions(...)`. */
export const RequireHelplineEnabledOrContinuing = () =>
  applyDecorators(UseGuards(HelplineEnabledOrContinuingGuard));

/** The tenant HelplineEnabledGuard resolved for this request. */
export const HelplineTenantParam = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): HelplineTenant =>
    ctx.switchToHttp().getRequest().helplineTenant,
);
