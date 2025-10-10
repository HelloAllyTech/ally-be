import { ApiOperation } from '@nestjs/swagger';

export const GenerateLiveKitToken = () =>
  ApiOperation({ summary: 'Generate LiveKit token' });

export const CreateLiveKitRoom = () =>
  ApiOperation({ summary: 'Create LiveKit room' });

export const ListLiveKitRooms = () =>
  ApiOperation({ summary: 'List LiveKit rooms' });

export const DeleteLiveKitRoom = () =>
  ApiOperation({ summary: 'Delete LiveKit room' });

export const ListRoomParticipants = () =>
  ApiOperation({ summary: 'List participants in a LiveKit room' });

export const RemoveRoomParticipant = () =>
  ApiOperation({ summary: 'Remove participant from LiveKit room' });

export const DispatchAgent = () =>
  ApiOperation({ summary: 'Dispatch agent to LiveKit room' });
