import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import {
  UnauthorizedException,
  ForbiddenException,
  ValidationException,
} from '../../exception/custom.exception';
import { PermissionsService } from 'src/authorization/service/permissions.service';

@Injectable()
export class WebSocketAuthMiddleware {
  private readonly logger = LoggerService.getInstance(
    WebSocketAuthMiddleware.name,
  );

  constructor(
    private jwtService: JwtService,
    private configService: AppConfigService,
    private permissionService: PermissionsService,
  ) {}

  webSocketMiddleware(permissions?: string[]) {
    return async (socket: Socket, next: (err?: Error) => void) => {
      try {
        this.logger.info(
          `Authentication middleware triggered for socket: ${socket.id}`,
        );

        // Extract token from multiple possible locations
        const token = this.extractToken(socket);

        if (!token) {
          const error = new UnauthorizedException('No JWT token provided');
          this.logger.error(
            `No JWT token provided for socket ${socket.id}: ${error.message}`,
          );
          return next(error);
        }

        // Verify JWT token
        const payload = await this.jwtService.verifyAsync(token, {
          secret: this.configService.jwt.accessToken.secret,
        });

        // Validate user ID
        const userId = parseInt(payload.sub);
        if (isNaN(userId)) {
          const error = new ValidationException('Invalid user ID in token');
          this.logger.error(
            `Invalid user ID in token for socket ${socket.id}: ${payload.sub}`,
          );
          return next(error);
        }

        // Check for required permissions
        if (permissions && permissions.length > 0) {
          const userPermissions =
            await this.permissionService.getUserPermissions(userId);

          const userHasPermission = permissions.every((permission) =>
            userPermissions.includes(permission),
          );

          if (!userHasPermission) {
            this.logger.error(
              `User ${userId} missing permissions: ${permissions.join(', ')}`,
            );
            return next(
              new ForbiddenException(
                `Missing permissions: ${permissions.join(', ')}`,
              ),
            );
          }
        }
        // Attach authenticated user data to socket
        socket.data.user = {
          id: userId,
          username: payload.username,
          tenantId: payload.tenantId,
        };

        this.logger.info(
          `Socket ${socket.id} authenticated successfully for user ${userId}`,
        );

        next(); // Allow connection to proceed
      } catch (error) {
        // Catch any unexpected errors
        const unexpectedError = new UnauthorizedException(
          'Authentication failed',
        );
        this.logger.error(
          `Unexpected error during WebSocket authentication for socket ${socket.id}:`,
          error.message,
        );
        next(unexpectedError);
      }
    };
  }

  private extractToken(socket: Socket): string | null {
    return socket.handshake.auth?.token;
  }
}
