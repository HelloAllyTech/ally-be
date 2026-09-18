import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/config.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { WebSocketAuthMiddleware } from './ws-auth.middleware';
import { Socket } from 'socket.io';
import { UnauthorizedException } from '../../exception/custom.exception';

describe('WebSocketAuthMiddleware', () => {
  let middleware: WebSocketAuthMiddleware;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSocketAuthMiddleware,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            jwt: {
              accessToken: {
                secret: 'test-secret',
              },
            },
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            getUserPermissions: jest.fn(),
          },
        },
      ],
    }).compile();

    middleware = module.get<WebSocketAuthMiddleware>(WebSocketAuthMiddleware);
    jwtService = module.get(JwtService);
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  describe('webSocketMiddleware', () => {
    let socket: jest.Mocked<Socket>;
    let next: jest.Mock;

    beforeEach(() => {
      socket = {
        id: 'test-socket-id',
        handshake: {
          auth: {
            token: 'test-token',
          },
        },
        data: {},
      } as any;
      next = jest.fn();
    });

    it('should call next with UnauthorizedException containing original error message for unexpected errors', async () => {
      const errorMessage = 'Internal server error';
      jwtService.verifyAsync.mockRejectedValue(new Error(errorMessage));

      await middleware.webSocketMiddleware()(socket, next);

      expect(next).toHaveBeenCalledWith(
        new UnauthorizedException(`Authentication failed: ${errorMessage}`),
      );
    });
  });
});
