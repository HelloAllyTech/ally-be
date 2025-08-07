import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { UserRole } from '../../common/constants/user.constants';

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: UserRole;
  tenantId: string;
}

@Injectable()
export class WebSocketAuthMiddleware {
  private readonly logger = LoggerService.getInstance(
    WebSocketAuthMiddleware.name,
  );

  constructor(
    private jwtService: JwtService,
    private configService: AppConfigService,
  ) {}

  createAuthMiddleware(requiredRole?: UserRole) {
    return async (socket: Socket, next: (err?: Error) => void) => {
      try {
        this.logger.info(
          `Authentication middleware triggered for socket: ${socket.id}`,
        );

        // Extract token from multiple possible locations
        const token = this.extractToken(socket);

        if (!token) {
          this.logger.error(`No JWT token provided for socket ${socket.id}`);
          return next(new Error('No JWT token provided'));
        }

        // Verify JWT token
        const payload = await this.jwtService.verifyAsync(token, {
          secret: this.configService.jwt.accessToken.secret,
        });
        console.log('JWT payload:', payload);

        // Role-based authorization
        if (requiredRole && payload.role !== requiredRole) {
          this.logger.error(
            `User ${payload.sub} does not have required role. Expected: ${requiredRole}, Got: ${payload.role}`,
          );
          return next(
            new Error(
              `Access denied. Required role: ${requiredRole}, but user has role: ${payload.role}`,
            ),
          );
        }

        const userId = parseInt(payload.sub);
        if (isNaN(userId)) {
          this.logger.error(`Invalid user ID in token: ${payload.sub}`);
          return next(new Error('Invalid user ID'));
        }

        // Attach authenticated user data to socket
        socket.data.user = {
          id: userId,
          username: payload.username,
          role: payload.role,
          tenantId: payload.tenantId,
        } as AuthenticatedUser;

        this.logger.info(
          `Socket ${socket.id} authenticated successfully for user ${userId} with role ${payload.role}`,
        );

        next(); // Allow connection to proceed
      } catch (error) {
        this.logger.error(
          `JWT verification failed for socket ${socket.id}:`,
          error.message,
        );
        next(new Error('Authentication failed'));
      }
    };
  }

  private extractToken(socket: Socket): string | null {
    return (
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      this.extractBearerToken(socket.request.headers.authorization)
    );
  }

  private extractBearerToken(authorization: string | undefined): string | null {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return null;
    }
    return authorization.substring(7);
  }

  static getAuthenticatedUser(socket: Socket): AuthenticatedUser | null {
    return socket.data.user || null;
  }
}
