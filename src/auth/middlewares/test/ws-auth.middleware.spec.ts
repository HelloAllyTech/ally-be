import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { WebSocketAuthMiddleware } from '../ws-auth.middleware';
import { AppConfigService } from '../../../config/config.service';
import { UserRole } from '../../../common/constants/user.constants';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ValidationException } from 'src/exception/custom.exception';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';

// Mock LoggerService
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

describe('WebSocketAuthMiddleware', () => {
  let middleware: WebSocketAuthMiddleware;
  let jwtService: jest.Mocked<JwtService>;
  let permissionsService: jest.Mocked<PermissionsService>;

  const mockJwtSecret = 'test-secret';
  const mockValidToken = 'valid.jwt.token';
  const mockValidPayload = {
    sub: '123',
    username: 'testuser',
    role: UserRole.COUNSELOR,
    tenantId: 'tenant-123',
  };

  beforeEach(async () => {
    const mockJwtService = {
      verifyAsync: jest.fn(),
    };

    const mockConfigService = {
      jwt: {
        accessToken: {
          secret: mockJwtSecret,
        },
      },
    };

    const mockPermissionsService = {
      getUserPermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSocketAuthMiddleware,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    middleware = module.get<WebSocketAuthMiddleware>(WebSocketAuthMiddleware);
    jwtService = module.get(JwtService);
    permissionsService = module.get(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockSocket = (overrides?: any): Socket => {
    return {
      id: 'socket-123',
      handshake: {
        auth: {},
        query: {},
        headers: {},
      },
      data: {},
      ...overrides,
    } as Socket;
  };

  const createMockNext = () => jest.fn();

  describe('createAuthMiddleware', () => {
    // Negative test cases first
    it('should reject connection when no token provided', async () => {
      const socket = createMockSocket();
      const next = createMockNext();
      const authMiddleware = middleware.webSocketMiddleware();

      await authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        new UnauthorizedException('No JWT token provided'),
      );
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should reject connection when token in invalid Bearer format', async () => {
      const socket = createMockSocket({
        handshake: {
          auth: {},
          query: {},
          headers: {
            authorization: 'InvalidFormat token123',
          },
        },
      });
      const next = createMockNext();
      const authMiddleware = middleware.webSocketMiddleware();

      await authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        new UnauthorizedException('No JWT token provided'),
      );
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should reject connection when user ID is invalid', async () => {
      const socket = createMockSocket({
        handshake: {
          auth: { token: mockValidToken },
          query: {},
          headers: {},
        },
      });
      const next = createMockNext();
      const authMiddleware = middleware.webSocketMiddleware();

      jwtService.verifyAsync.mockResolvedValue({
        ...mockValidPayload,
        sub: 'invalid-user-id',
      });

      await authMiddleware(socket, next);

      expect(jwtService.verifyAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(mockValidToken, {
        secret: mockJwtSecret,
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        new ValidationException('Invalid user ID in token'),
      );
    });

    it('should reject connection when user does not have required permissions', async () => {
      const socket = createMockSocket({
        handshake: {
          auth: { token: mockValidToken },
          query: {},
          headers: {},
        },
      });
      const next = createMockNext();
      const authMiddleware = middleware.webSocketMiddleware([
        PERMISSIONS.START_MICROPHONE_CHAT,
      ]);

      jwtService.verifyAsync.mockResolvedValue(mockValidPayload);
      permissionsService.getUserPermissions.mockResolvedValue([]);

      await authMiddleware(socket, next);

      expect(jwtService.verifyAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(mockValidToken, {
        secret: mockJwtSecret,
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        new ForbiddenException(
          `Missing permissions: ${PERMISSIONS.START_MICROPHONE_CHAT}`,
        ),
      );
    });

    it('should reject connection on unexpected JWT verification error', async () => {
      const socket = createMockSocket({
        handshake: {
          auth: { token: mockValidToken },
          query: {},
          headers: {},
        },
      });
      const next = createMockNext();
      const authMiddleware = middleware.webSocketMiddleware();

      jwtService.verifyAsync.mockRejectedValue(
        new Error('Token expired or invalid'),
      );

      await authMiddleware(socket, next);

      expect(jwtService.verifyAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(mockValidToken, {
        secret: mockJwtSecret,
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        new UnauthorizedException('Authentication failed'),
      );
    });

    // Positive test cases
    it('should authenticate successfully with token in auth field', async () => {
      const socket = createMockSocket({
        handshake: {
          auth: { token: mockValidToken },
          query: {},
          headers: {},
        },
      });
      const next = createMockNext();
      const authMiddleware = middleware.webSocketMiddleware();

      jwtService.verifyAsync.mockResolvedValue(mockValidPayload);

      await authMiddleware(socket, next);

      expect(jwtService.verifyAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(mockValidToken, {
        secret: mockJwtSecret,
      });
      expect(socket.data.user).toEqual({
        id: 123,
        username: 'testuser',
        tenantId: 'tenant-123',
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('should authenticate successfully with required permissions', async () => {
      const socket = createMockSocket({
        handshake: {
          auth: { token: mockValidToken },
          query: {},
          headers: {},
        },
      });
      const next = createMockNext();
      const authMiddleware = middleware.webSocketMiddleware([
        PERMISSIONS.START_MICROPHONE_CHAT,
      ]);

      jwtService.verifyAsync.mockResolvedValue(mockValidPayload);
      permissionsService.getUserPermissions.mockResolvedValue([
        PERMISSIONS.START_MICROPHONE_CHAT,
      ]);

      await authMiddleware(socket, next);

      expect(jwtService.verifyAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(mockValidToken, {
        secret: mockJwtSecret,
      });
      expect(socket.data.user).toEqual({
        id: 123,
        username: 'testuser',
        tenantId: 'tenant-123',
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
