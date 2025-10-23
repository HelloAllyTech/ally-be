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
} from '../decorator/api-documentation.decorator';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiTags('LiveKit')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/livekit')
export class LiveKitController {
  constructor(private readonly liveKitService: LiveKitService) {}

  @GenerateLiveKitToken()
  @Post('token')
  @AuthPermissions([PERMISSIONS.EDIT_LIVEKIT])
  async generateToken(@Body() joinRoomDto: JoinRoomDto) {
    return this.liveKitService.generateAccessToken(joinRoomDto);
  }

  @CreateLiveKitRoom()
  @Post('rooms')
  @AuthPermissions([PERMISSIONS.EDIT_LIVEKIT])
  async createRoom(@Body() createRoomDto: CreateRoomDto) {
    return this.liveKitService.createRoom(createRoomDto);
  }

  @ListLiveKitRooms()
  @Get('rooms')
  @AuthPermissions([PERMISSIONS.VIEW_LIVEKIT])
  async listRooms() {
    return this.liveKitService.listRooms();
  }

  @DeleteLiveKitRoom()
  @Delete('rooms/:roomName')
  @AuthPermissions([PERMISSIONS.EDIT_LIVEKIT])
  async deleteRoom(@Param('roomName') roomName: string) {
    await this.liveKitService.deleteRoom(roomName);
    return { message: 'Room deleted successfully' };
  }

  @ListRoomParticipants()
  @Get('rooms/:roomName/participants')
  @AuthPermissions([PERMISSIONS.VIEW_LIVEKIT])
  async listParticipants(@Param('roomName') roomName: string) {
    return this.liveKitService.listParticipants(roomName);
  }

  @RemoveRoomParticipant()
  @Delete('rooms/:roomName/participants/:participantIdentity')
  @AuthPermissions([PERMISSIONS.EDIT_LIVEKIT])
  async removeParticipant(
    @Param('roomName') roomName: string,
    @Param('participantIdentity') participantIdentity: string,
  ) {
    return this.liveKitService.removeParticipant(roomName, participantIdentity);
  }

  @DispatchAgent()
  @Post('rooms/:roomName/agent-dispatch')
  @AuthPermissions([PERMISSIONS.EDIT_LIVEKIT])
  async agentDispatch(
    @Param('roomName') roomName: string,
    @Param('participantIdentity') participantIdentity: string = 'Agent',
  ) {
    return this.liveKitService.agentDispatch(roomName, participantIdentity);
  }
}
