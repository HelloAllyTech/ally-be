import { Body, Controller, Post } from '@nestjs/common';
import { SessionEventService } from '../service/session-event.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { SessionEvents } from '../entity/session-events.entity';
import { CreateSessionEventsDto } from '../dto/create-session-events.dto';

@ApiTags('SessionEvents')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/session-events')
export class SessionEventController {
  constructor(private readonly sessionEventService: SessionEventService) {}

  @ApiOperation({ summary: 'Create session events' })
  @ApiBody({ type: CreateSessionEventsDto })
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post()
  createSessionEvents(
    @Body() createEventsDto: CreateSessionEventsDto,
  ): Promise<SessionEvents[]> {
    return this.sessionEventService.createSessionEvents(createEventsDto.events);
  }
}
