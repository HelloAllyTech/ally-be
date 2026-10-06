import { HttpException } from '@nestjs/common';
import { testCipher } from './helpline-test-cipher';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from 'src/exception/error-code.enum';
import { JwtStrategy } from 'src/auth/strategies/jwt.strategy';
import { HELPLINE_GUEST } from '../../constants/helpline.constants';
import {
  HelplineGuestGuard,
  resolveGuest,
} from '../../guard/helpline-guest.guard';
import { HelplineGuestTokenService } from '../helpline-guest-token.service';

const ACCESS_SECRET = 'test-access-secret';
const identity = {
  talkerId: '22222222-2222-4222-8222-222222222222',
  chatId: '11111111-1111-4111-8111-111111111111',
  tenantId: '33333333-3333-4333-8333-333333333333',
};

const config = (guestSecret = '') =>
  ({
    helplineGuestJwtSecret: guestSecret,
    jwt: { accessToken: { secret: ACCESS_SECRET, expiresIn: '1d' } },
  }) as never;

const errorCodeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { errorCode?: string })
      .errorCode;
  }
  return 'no error';
};

describe('HelplineGuestTokenService', () => {
  const jwt = new JwtService({});
  const service = new HelplineGuestTokenService(jwt, config());

  it('derives a secret that is not the access secret', () => {
    expect(service.secret()).not.toBe(ACCESS_SECRET);
    expect(service.secret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses HELPLINE_GUEST_JWT_SECRET verbatim when it is set', () => {
    expect(
      new HelplineGuestTokenService(jwt, config('dedicated')).secret(),
    ).toBe('dedicated');
  });

  it('round-trips a guest token with aud, typ and the contract claims', async () => {
    const { token, expiresAt } = await service.sign(identity);
    expect(await service.verify(token)).toEqual(identity);
    const claims = jwt.decode(token) as Record<string, unknown>;
    expect(claims).toMatchObject({
      aud: HELPLINE_GUEST.AUDIENCE,
      sub: identity.talkerId,
      typ: HELPLINE_GUEST.TOKEN_TYPE,
      cid: identity.chatId,
      tid: identity.tenantId,
      ch: 'TEXT_WEB',
    });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(
      23.9 * 3600 * 1000,
    );
    expect(service.looksLikeGuestToken(token)).toBe(true);
  });

  it('rejects a user access token (signed with the access secret)', async () => {
    const userToken = await jwt.signAsync(
      { sub: 5, username: 'listener', tenantId: identity.tenantId },
      { secret: ACCESS_SECRET },
    );
    expect(service.looksLikeGuestToken(userToken)).toBe(false);
    expect(await errorCodeOf(service.verify(userToken))).toBe(
      ErrorCode.HELPLINE_GUEST_TOKEN_INVALID,
    );
  });

  it('rejects a token signed with the guest secret but the wrong audience or type', async () => {
    const wrongAud = await jwt.signAsync(
      {
        typ: HELPLINE_GUEST.TOKEN_TYPE,
        cid: identity.chatId,
        tid: identity.tenantId,
      },
      {
        secret: service.secret(),
        audience: 'something-else',
        subject: identity.talkerId,
      },
    );
    const wrongTyp = await jwt.signAsync(
      { typ: 'user', cid: identity.chatId, tid: identity.tenantId },
      {
        secret: service.secret(),
        audience: HELPLINE_GUEST.AUDIENCE,
        subject: identity.talkerId,
      },
    );
    expect(await errorCodeOf(service.verify(wrongAud))).toBe(
      ErrorCode.HELPLINE_GUEST_TOKEN_INVALID,
    );
    expect(await errorCodeOf(service.verify(wrongTyp))).toBe(
      ErrorCode.HELPLINE_GUEST_TOKEN_INVALID,
    );
  });

  it('rejects an expired token', async () => {
    const { token } = await service.sign(identity, new Date(Date.now() + 1000));
    jest.useFakeTimers({ now: Date.now() + 5000 });
    try {
      expect(await errorCodeOf(service.verify(token))).toBe(
        ErrorCode.HELPLINE_GUEST_TOKEN_INVALID,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('a guest token does not verify under the secret JwtStrategy uses', async () => {
    const strategy = new JwtStrategy(config(), {} as never, {} as never);
    const strategySecret = await new Promise<string>((resolve, reject) =>
      (
        strategy as unknown as {
          _secretOrKeyProvider: (
            req: unknown,
            raw: string,
            done: (e: unknown, s?: string) => void,
          ) => void;
        }
      )._secretOrKeyProvider(null, '', (err, secret) =>
        err ? reject(err) : resolve(secret!),
      ),
    );
    expect(strategySecret).toBe(ACCESS_SECRET);
    const { token } = await service.sign(identity);
    await expect(
      jwt.verifyAsync(token, { secret: strategySecret }),
    ).rejects.toThrow();
  });

  it('hashes ips with a server-side salt (stable, not the raw ip)', () => {
    const hash = service.hashIp('203.0.113.7');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(service.hashIp('203.0.113.7'));
    expect(hash).not.toBe(service.hashIp('203.0.113.8'));
    expect(service.hashIp(null)).toBeNull();
  });
});

describe('HelplineGuestGuard', () => {
  const jwt = new JwtService({});
  const tokens = new HelplineGuestTokenService(jwt, config());
  const talker = {
    id: identity.talkerId,
    tenantId: identity.tenantId,
    revokedAt: null,
  };
  const chat = {
    id: identity.chatId,
    tenantId: identity.tenantId,
    talkerId: identity.talkerId,
  };

  const build = (talkerRow: unknown, chatRow: unknown) => {
    const talkers = { findOne: jest.fn().mockResolvedValue(talkerRow) };
    const chats = { findForGuest: jest.fn().mockResolvedValue(chatRow) };
    return {
      guard: new HelplineGuestGuard(
        tokens,
        talkers as never,
        chats as never,
        testCipher(),
      ),
      talkers,
      chats,
    };
  };
  const contextWith = (authorization?: string) => {
    const request: Record<string, unknown> = { headers: { authorization } };
    return {
      request,
      context: { switchToHttp: () => ({ getRequest: () => request }) } as never,
    };
  };

  it('admits a valid guest token and loads the chat by the token’s own ids, tenant-scoped', async () => {
    const { guard, talkers, chats } = build(talker, chat);
    const { token } = await tokens.sign(identity);
    const { request, context } = contextWith(`Bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(talkers.findOne).toHaveBeenCalledWith({
      where: { id: identity.talkerId, tenantId: identity.tenantId },
    });
    expect(chats.findForGuest).toHaveBeenCalledWith(
      identity.tenantId,
      identity.chatId,
      identity.talkerId,
    );
    expect(request.helplineGuest).toEqual({ chat, talker });
  });

  it('rejects a revoked talker', async () => {
    const { guard } = build({ ...talker, revokedAt: new Date() }, chat);
    const { token } = await tokens.sign(identity);
    expect(
      await errorCodeOf(
        guard.canActivate(contextWith(`Bearer ${token}`).context),
      ),
    ).toBe(ErrorCode.HELPLINE_GUEST_TOKEN_INVALID);
  });

  it('rejects a user access token', async () => {
    const { guard, talkers } = build(talker, chat);
    const userToken = await jwt.signAsync(
      { sub: 5 },
      { secret: ACCESS_SECRET },
    );
    expect(
      await errorCodeOf(
        guard.canActivate(contextWith(`Bearer ${userToken}`).context),
      ),
    ).toBe(ErrorCode.HELPLINE_GUEST_TOKEN_INVALID);
    expect(talkers.findOne).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    const { guard } = build(talker, chat);
    expect(
      await errorCodeOf(guard.canActivate(contextWith(undefined).context)),
    ).toBe(ErrorCode.HELPLINE_GUEST_TOKEN_INVALID);
  });

  it('resolveGuest refuses when the chat is not this talker’s', async () => {
    const talkers = { findOne: jest.fn().mockResolvedValue(talker) };
    const chats = { findForGuest: jest.fn().mockResolvedValue(null) };
    await expect(
      resolveGuest(identity, talkers as never, chats as never, testCipher()),
    ).resolves.toBeNull();
  });
});
