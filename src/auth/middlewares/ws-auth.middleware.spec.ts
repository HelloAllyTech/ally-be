import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/config.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { WebSocketAuthMiddleware } from './ws-auth.middleware';
import { Socket } from 'socket.io';
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

    it('should call next with the original error when jwtService.verifyAsync throws an error', async () => {
      const originalError = new Error('Internal server error');
      jwtService.verifyAsync.mockRejectedValue(originalError);

      await middleware.webSocketMiddleware()(socket, next);

      expect(next).toHaveBeenCalledWith(originalError);
    });
  });
});
