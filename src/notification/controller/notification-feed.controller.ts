import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { InAppNotificationService } from '../service/in-app-notification.service';
import { DeviceTokenService } from '../service/device-token.service';
import {
  ListNotificationsQueryDto,
  NotificationActionResultDto,
  NotificationFeedResponseDto,
  UnreadNotificationCountDto,
} from '../dto/notification-feed.dto';
import { RegisterDeviceTokenDto } from '../dto/device-token.dto';

/**
 * The recipient-side notification feed (bell on web, Notifications screen on
 * mobile) and FCM device-token registration. Every route is scoped to the
 * caller's own JWT user id — there is no permission gate beyond being
 * authenticated, since a user only ever reads/writes their own rows.
 */
@Controller('v1/notifications')
@ApiTags('Notifications')
@ApiBearerAuth()
@ApiSecurity('access-token')
@UseGuards(JwtAuthGuard)
export class NotificationFeedController {
  constructor(
    private readonly notificationService: InAppNotificationService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

  @ApiOperation({ summary: "List the caller's notification feed" })
  @ApiResponse({ status: 200, type: NotificationFeedResponseDto })
  @Get()
  async list(
    @CurrentUser() user: TokenUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationFeedResponseDto> {
    const { data, count } = await this.notificationService.list(user.id, {
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
      unreadOnly: query.unreadOnly ?? false,
    });
    return {
      count,
      data: data.map((notification) => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? null,
        readAt: notification.readAt ? notification.readAt.toISOString() : null,
        createdAt: notification.createdAt.toISOString(),
      })),
    };
  }

  @ApiOperation({ summary: "Unread count for the caller's notification feed" })
  @ApiResponse({ status: 200, type: UnreadNotificationCountDto })
  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: TokenUser,
  ): Promise<UnreadNotificationCountDto> {
    const count = await this.notificationService.unreadCount(user.id);
    return { count };
  }

  @ApiOperation({ summary: 'Mark one notification read' })
  @ApiResponse({ status: 200, type: NotificationActionResultDto })
  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: TokenUser,
    @Param('id') id: string,
  ): Promise<NotificationActionResultDto> {
    const success = await this.notificationService.markRead(user.id, id);
    return { success };
  }

  @ApiOperation({
    summary: "Mark every one of the caller's notifications read",
  })
  @ApiResponse({ status: 200, type: NotificationActionResultDto })
  @Patch('read-all')
  async markAllRead(
    @CurrentUser() user: TokenUser,
  ): Promise<NotificationActionResultDto> {
    const success = await this.notificationService.markAllRead(user.id);
    return { success };
  }

  @ApiOperation({
    summary: "Register (or refresh) the caller's FCM device token",
  })
  @ApiResponse({ status: 200, type: NotificationActionResultDto })
  @Put('device-tokens')
  async registerDeviceToken(
    @CurrentUser() user: TokenUser,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<NotificationActionResultDto> {
    await this.deviceTokenService.register(
      user.id,
      user.tenantId,
      dto.token,
      dto.platform,
    );
    return { success: true };
  }

  @ApiOperation({
    summary: "Unregister the caller's own FCM device token (logout)",
  })
  @ApiResponse({ status: 200, type: NotificationActionResultDto })
  @Delete('device-tokens/:token')
  async deleteDeviceToken(
    @CurrentUser() user: TokenUser,
    @Param('token') token: string,
  ): Promise<NotificationActionResultDto> {
    await this.deviceTokenService.remove(user.id, token);
    return { success: true };
  }
}
