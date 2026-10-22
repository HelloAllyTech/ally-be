import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { Socket } from 'socket.io';
import * as bcrypt from 'bcrypt';
import { AppConfigService } from 'src/config/config.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { EmailService } from 'src/notification/service/email.service';
import { JwtStrategy } from 'src/auth/strategies/jwt.strategy';
import { LastActiveService } from 'src/auth/service/last-active.service';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { LabEvaluatorGuard } from '../lab-evaluator.guard';
import { LabEvaluatorService } from '../../service/lab-evaluator.service';
import { LabEvaluatorRepository } from '../../repository/lab-evaluator.repository';
import { LabRunAssignmentRepository } from '../../repository/lab-eval.repositories';
import { EVALUATOR_TOKEN_KIND } from '../../constants/lab-eval.constants';

/**
 * Real tokens through the real verifiers, in both directions: an AI Lab
 * evaluator token must not open a platform route over HTTP or WebSocket, and
 * a platform token must not open the evaluator portal. Nothing here mocks the
 * signature check — that is the thing under test.
 */
describe('AI Lab evaluator tokens vs platform auth', () => {
  const ACCESS_SECRET = 'access-secret-for-tests';
  // A uuid whose leading digit parseInt would read as platform user 3.
  const EVALUATOR_ID = '3f2a6c1e-0000-4000-8000-000000000000';
  const PASSWORD = 'correct-horse';

  const jwtService = new JwtService();
  const configService = {
    jwt: { accessToken: { secret: ACCESS_SECRET, expiresIn: '15m' } },
  } as unknown as AppConfigService;

  let evaluatorRepository: { findOne: jest.Mock; save: jest.Mock };
  let permissionsService: { getUserPermissions: jest.Mock };
  let lastActiveService: { touch: jest.Mock };
  let evaluatorService: LabEvaluatorService;

  const buildEvaluatorService = (config: AppConfigService) =>
    new LabEvaluatorService(
      evaluatorRepository as unknown as LabEvaluatorRepository,
      {} as LabRunAssignmentRepository,
      jwtService,
      config,
      {} as EmailService,
    );

  beforeAll(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as LoggerService);
    jest
      .spyOn(ExecutionManager, 'setAuthContext')
      .mockImplementation(() => undefined as never);
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    evaluatorRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: EVALUATOR_ID,
        email: 'eval@x.com',
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        tokenVersion: 0,
      }),
      save: jest.fn(async (e) => e),
    };
    // The worst case: the user id an evaluator's uuid could be misread as is
    // a platform-wide admin, so only the token checks stand in the way.
    permissionsService = {
      getUserPermissions: jest
        .fn()
        .mockResolvedValue([
          PERMISSIONS.SYSTEM_ACCESS,
          PERMISSIONS.START_MICROPHONE_CHAT,
        ]),
    };
    lastActiveService = { touch: jest.fn().mockResolvedValue(undefined) };
    evaluatorService = buildEvaluatorService(configService);
    // Registers the 'jwt' passport strategy that AuthGuard('jwt') runs.
    new JwtStrategy(
      configService,
      permissionsService as unknown as PermissionsService,
      lastActiveService as unknown as LastActiveService,
    );
  });

  const evaluatorToken = async () =>
    (
      await evaluatorService.login({
        email: 'eval@x.com',
        password: PASSWORD,
      })
    ).accessToken;

  /** What every evaluator token looked like before the derived key. */
  const legacyEvaluatorToken = () =>
    jwtService.signAsync(
      {
        sub: EVALUATOR_ID,
        email: 'eval@x.com',
        kind: EVALUATOR_TOKEN_KIND,
        tv: 0,
      },
      { secret: ACCESS_SECRET, expiresIn: '7d' },
    );

  /** Signed the way AuthService.generateTokens signs an access token. */
  const platformToken = () =>
    jwtService.signAsync(
      { sub: 101, username: 'alice', tenantId: 'tenant-1' },
      { secret: ACCESS_SECRET, expiresIn: '15m' },
    );

  const httpContext = (token: string) => {
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };
    const context = {
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => jest.fn(),
      }),
    } as unknown as ExecutionContext;
    return { request, context };
  };

  const platformHttp = async (token: string) => {
    const { request, context } = httpContext(token);
    await new (AuthGuard('jwt'))().canActivate(context);
    return request.user;
  };

  const platformSocket = async (token: string) => {
    const socket = {
      id: 'socket-1',
      handshake: { auth: { token }, query: {}, headers: {} },
      data: {},
    } as unknown as Socket;
    const next = jest.fn();
    await new WebSocketAuthMiddleware(
      jwtService,
      configService,
      permissionsService as unknown as PermissionsService,
    ).webSocketMiddleware([PERMISSIONS.START_MICROPHONE_CHAT])(socket, next);
    return { socket, error: next.mock.calls[0][0] as Error | undefined };
  };

  const evaluatorPortal = async (token: string) => {
    const { request, context } = httpContext(token);
    await new LabEvaluatorGuard(evaluatorService).canActivate(context);
    return request.evaluator;
  };

  describe('an evaluator token from login', () => {
    it('opens the evaluator portal', async () => {
      await expect(evaluatorPortal(await evaluatorToken())).resolves.toEqual({
        id: EVALUATOR_ID,
        email: 'eval@x.com',
      });
    });

    it('is not signed with the access secret', async () => {
      await expect(
        jwtService.verifyAsync(await evaluatorToken(), {
          secret: ACCESS_SECRET,
        }),
      ).rejects.toThrow();
    });

    it('does not open a platform HTTP route', async () => {
      await expect(platformHttp(await evaluatorToken())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(ExecutionManager.setAuthContext).not.toHaveBeenCalled();
      expect(lastActiveService.touch).not.toHaveBeenCalled();
    });

    it('does not open a platform WebSocket', async () => {
      const { socket, error } = await platformSocket(await evaluatorToken());
      expect(error).toBeInstanceOf(Error);
      expect(socket.data.user).toBeUndefined();
    });
  });

  // Tokens issued before this change are still in browsers for up to 7 days
  // and DO verify under the access secret; only the kind check stops them.
  describe('an evaluator token signed the old way, with the access secret', () => {
    it('does not open a platform HTTP route', async () => {
      await expect(platformHttp(await legacyEvaluatorToken())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(ExecutionManager.setAuthContext).not.toHaveBeenCalled();
      expect(permissionsService.getUserPermissions).not.toHaveBeenCalled();
    });

    it('does not open a platform WebSocket', async () => {
      const { socket, error } = await platformSocket(
        await legacyEvaluatorToken(),
      );
      expect(error?.message).toBe('Invalid token');
      expect(socket.data.user).toBeUndefined();
      expect(permissionsService.getUserPermissions).not.toHaveBeenCalled();
    });

    it('no longer opens the evaluator portal either (one-time re-login)', async () => {
      await expect(
        evaluatorPortal(await legacyEvaluatorToken()),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('a platform access token', () => {
    it('still opens a platform HTTP route', async () => {
      await expect(platformHttp(await platformToken())).resolves.toEqual({
        id: 101,
        username: 'alice',
        tenantId: 'tenant-1',
      });
    });

    it('still opens a platform WebSocket', async () => {
      const { socket, error } = await platformSocket(await platformToken());
      expect(error).toBeUndefined();
      expect(socket.data.user).toEqual({
        id: 101,
        username: 'alice',
        tenantId: 'tenant-1',
      });
    });

    it('does not open the evaluator portal', async () => {
      await expect(evaluatorPortal(await platformToken())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(evaluatorRepository.findOne).not.toHaveBeenCalled();
    });
  });

  it('fails closed when the access secret is not configured', async () => {
    const unconfigured = buildEvaluatorService({
      jwt: { accessToken: { secret: '' } },
    } as unknown as AppConfigService);

    await expect(
      unconfigured.login({ email: 'eval@x.com', password: PASSWORD }),
    ).rejects.toThrow('JWT_ACCESS_SECRET is not configured');
    await expect(unconfigured.verifyToken('anything')).rejects.toThrow(
      'JWT_ACCESS_SECRET is not configured',
    );
  });
});
