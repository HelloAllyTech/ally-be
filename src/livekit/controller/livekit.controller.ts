import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
import { JoinRoomDto } from '../dto/join-room.dto';
import { CreateRoomDto } from '../dto/create-room.dto';
import { LiveKitService } from '../service/livekit.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from 'src/common/constants/user.constants';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';

@ApiTags('LiveKit')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/livekit')
export class LiveKitController {
  constructor(private readonly liveKitService: LiveKitService) {}

  @Post('token')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Generate LiveKit token' })
  async generateToken(@Body() joinRoomDto: JoinRoomDto) {
    return this.liveKitService.generateAccessToken(joinRoomDto);
  }

  @Post('rooms')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create LiveKit room' })
  async createRoom(@Body() createRoomDto: CreateRoomDto) {
    return this.liveKitService.createRoom(createRoomDto);
  }

  @Get('rooms')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List LiveKit rooms' })
  async listRooms() {
    return this.liveKitService.listRooms();
  }

  @Delete('rooms/:roomName')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete LiveKit room' })
  async deleteRoom(@Param('roomName') roomName: string) {
    await this.liveKitService.deleteRoom(roomName);
    return { message: 'Room deleted successfully' };
  }

  @Get('rooms/:roomName/participants')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List participants in a LiveKit room' })
  async listParticipants(@Param('roomName') roomName: string) {
    return this.liveKitService.listParticipants(roomName);
  }

  @Delete('rooms/:roomName/participants/:participantIdentity')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove participant from LiveKit room' })
  async removeParticipant(
    @Param('roomName') roomName: string,
    @Param('participantIdentity') participantIdentity: string,
  ) {
    return this.liveKitService.removeParticipant(roomName, participantIdentity);
  }

  @Post('rooms/:roomName/agent-dispatch')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Dispatch agent to LiveKit room' })
  async agentDispatch(
    @Param('roomName') roomName: string,
    @Param('participantIdentity') participantIdentity: string = 'Agent',
  ) {
    return this.liveKitService.agentDispatch(roomName, participantIdentity);
  }
}
