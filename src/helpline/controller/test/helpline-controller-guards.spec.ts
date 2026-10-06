import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HttpException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ErrorCode } from 'src/exception/error-code.enum';
import { CustomThrottlerGuard } from 'src/rate-limit/guard/custom-throttler.guard';
import {
  HelplineChatScopedGuard,
  HelplineEnabledGuard,
} from '../../guard/helpline-enabled.guard';
import { HelplineGuestGuard } from '../../guard/helpline-guest.guard';
import { HelplineAdminController } from '../helpline-admin.controller';
import { HelplineGuestController } from '../helpline-guest.controller';
import { HelplinePublicController } from '../helpline-public.controller';
import { HelplineController } from '../helpline.controller';

const JwtGuard = AuthGuard('jwt');

const handlers = (controller: { prototype: object }) =>
  Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map(
      (name) =>
        [
          name,
          (controller.prototype as Record<string, unknown>)[name],
        ] as const,
    );

const guardsOf = (target: object): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

/**
 * The only routes a listener of record keeps while the helpline is switched
 * off (contract §5.4). Everything else — lobby, claim, presence, monitor,
 * supervision, QA, team — refuses with HELPLINE_DISABLED.
 */
const CHAT_SCOPED_ROUTES = [
  'chatDetail',
  'chatMessages',
  'endChat',
  'saveSummary',
  'acknowledgeFlag',
  'copilotFeedback',
  'alertSupervisor',
];

describe('helpline controller guards', () => {
  it('exactly the chat-scoped routes use the chat-scoped gate', () => {
    const scoped = handlers(HelplineController)
      .filter(([, handler]) =>
        guardsOf(handler as object).includes(HelplineChatScopedGuard),
      )
      .map(([name]) => name)
      .sort();
    expect(scoped).toEqual(
      CHAT_SCOPED_ROUTES.filter((name) =>
        handlers(HelplineController).some(([n]) => n === name),
      ).sort(),
    );
    // …and never both: the plain gate would refuse the listener of record.
    for (const [name, handler] of handlers(HelplineController)) {
      if (!CHAT_SCOPED_ROUTES.includes(name)) continue;
      expect(
        guardsOf(handler as object).filter((g) => g === HelplineEnabledGuard),
      ).toEqual([]);
    }
  });

  describe('HelplineController (listener routes)', () => {
    it.each(
      handlers(HelplineController).filter(([name]) => name !== 'enabled'),
    )(
      '%s requires JWT → permission → helpline gate, in that order',
      (name, handler) => {
        const guards = guardsOf(handler as object);
        const jwt = guards.indexOf(JwtGuard);
        const perms = guards.indexOf(PermissionsGuard);
        const gate = guards.indexOf(
          CHAT_SCOPED_ROUTES.includes(name)
            ? HelplineChatScopedGuard
            : HelplineEnabledGuard,
        );
        expect(jwt).toBeGreaterThanOrEqual(0);
        expect(perms).toBeGreaterThan(jwt);
        expect(gate).toBeGreaterThan(perms);
        const required = Reflect.getMetadata(
          PERMISSIONS_KEY,
          handler as object,
        );
        expect(required.permissions.length).toBeGreaterThan(0);
        expect(
          required.permissions.every((p: string) => p.includes(':helpline:')),
        ).toBe(true);
      },
    );

    it('`enabled` is authenticated-only and never gated (it IS the nav gate)', () => {
      const guards = guardsOf(HelplineController.prototype.enabled);
      expect(guards).toContain(JwtGuard);
      expect(guards).not.toContain(HelplineEnabledGuard);
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          HelplineController.prototype.enabled,
        ).permissions,
      ).toEqual([]);
    });

    it('nothing is guarded at class level (class guards would run before the JWT guard)', () => {
      expect(guardsOf(HelplineController)).toEqual([]);
    });
  });

  describe('HelplineGuestController', () => {
    it('is guarded by the guest guard only — never the user JWT strategy', () => {
      expect(guardsOf(HelplineGuestController)).toEqual([HelplineGuestGuard]);
      for (const [, handler] of handlers(HelplineGuestController)) {
        expect(guardsOf(handler as object)).not.toContain(JwtGuard);
      }
    });
  });

  describe('HelplinePublicController', () => {
    it('session create is rate limited; nothing needs auth', () => {
      expect(
        guardsOf(HelplinePublicController.prototype.createSession),
      ).toEqual([CustomThrottlerGuard]);
      expect(guardsOf(HelplinePublicController.prototype.status)).toEqual([]);
    });
  });

  describe('HelplineAdminController', () => {
    it.each(handlers(HelplineAdminController))(
      '%s needs EDIT_GLOBAL_SETTINGS',
      (_, handler) => {
        expect(guardsOf(handler as object)).toEqual([
          JwtGuard,
          PermissionsGuard,
        ]);
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, handler as object).permissions,
        ).toEqual([PERMISSIONS.EDIT_GLOBAL_SETTINGS]);
      },
    );
  });
});

describe('HelplineEnabledGuard', () => {
  const context = (user: unknown) => {
    const request: Record<string, unknown> = { user };
    return {
      request,
      ctx: { switchToHttp: () => ({ getRequest: () => request }) } as never,
    };
  };
  const tenant = { id: 't-1', code: 'acme', name: 'Acme', logoUrl: null };

  it('403 HELPLINE_DISABLED when the tenant has not switched it on (fail closed)', async () => {
    const guard = new HelplineEnabledGuard(
      { isEnabledForTenant: jest.fn().mockResolvedValue(false) } as never,
      { resolve: jest.fn() } as never,
    );
    try {
      await guard.canActivate(context({ id: 1, tenantId: 'acme' }).ctx);
      throw new Error('should have refused');
    } catch (error) {
      const e = error as HttpException;
      expect(e.getStatus()).toBe(403);
      expect((e.getResponse() as { errorCode: string }).errorCode).toBe(
        ErrorCode.HELPLINE_DISABLED,
      );
    }
  });

  it('401 when it runs without a user (i.e. written below @AuthPermissions)', async () => {
    const guard = new HelplineEnabledGuard({} as never, {} as never);
    await expect(
      guard.canActivate(context(undefined).ctx),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('passes and resolves the tenant onto the request when enabled', async () => {
    const isEnabledForTenant = jest.fn().mockResolvedValue(true);
    const guard = new HelplineEnabledGuard(
      { isEnabledForTenant } as never,
      { resolve: jest.fn().mockResolvedValue(tenant) } as never,
    );
    const { request, ctx } = context({ id: 1, tenantId: 'acme' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(isEnabledForTenant).toHaveBeenCalledWith(
      'TEXT_HELPLINE_ENABLED',
      'acme',
    );
    expect(request.helplineTenant).toBe(tenant);
  });
});
