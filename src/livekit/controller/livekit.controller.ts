import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
import { JoinRoomDto } from '../dto/join-room.dto';
import { CreateRoomDto } from '../dto/create-room.dto';
import { LiveKitService } from '../service/livekit.service';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  GenerateLiveKitToken,
  CreateLiveKitRoom,
  ListLiveKitRooms,
  DeleteLiveKitRoom,
  ListRoomParticipants,
  RemoveRoomParticipant,
  DispatchAgent,
} from '../decorators/api-documentation.decorators';
import { UserRole } from 'src/common/constants/user.constants';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';

@ApiTags('LiveKit')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/livekit')
export class LiveKitController {
  constructor(private readonly liveKitService: LiveKitService) {}

  @GenerateLiveKitToken()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('token')
  async generateToken(@Body() joinRoomDto: JoinRoomDto) {
    return this.liveKitService.generateAccessToken(joinRoomDto);
  }

  @CreateLiveKitRoom()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('rooms')
  async createRoom(@Body() createRoomDto: CreateRoomDto) {
    return this.liveKitService.createRoom(createRoomDto);
  }

  @ListLiveKitRooms()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Get('rooms')
  async listRooms() {
    return this.liveKitService.listRooms();
  }

  @DeleteLiveKitRoom()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Delete('rooms/:roomName')
  async deleteRoom(@Param('roomName') roomName: string) {
    await this.liveKitService.deleteRoom(roomName);
    return { message: 'Room deleted successfully' };
  }

  @ListRoomParticipants()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Get('rooms/:roomName/participants')
  async listParticipants(@Param('roomName') roomName: string) {
    return this.liveKitService.listParticipants(roomName);
  }

  @RemoveRoomParticipant()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Delete('rooms/:roomName/participants/:participantIdentity')
  async removeParticipant(
    @Param('roomName') roomName: string,
    @Param('participantIdentity') participantIdentity: string,
  ) {
    return this.liveKitService.removeParticipant(roomName, participantIdentity);
  }

  @DispatchAgent()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('rooms/:roomName/agent-dispatch')
  async agentDispatch(
    @Param('roomName') roomName: string,
    @Param('participantIdentity') participantIdentity: string = 'Agent',
  ) {
    return this.liveKitService.agentDispatch(roomName, participantIdentity);
  }
}
