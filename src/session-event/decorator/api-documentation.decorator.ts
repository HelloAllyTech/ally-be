import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiBody } from '@nestjs/swagger';
import { CreateSessionEventsDto } from '../dto/create-session-events.dto';
import { UpdateSessionEventDto } from '../dto/update-session-event.dto';

export const CreateSessionEvents = () =>
  applyDecorators(
    ApiOperation({ summary: 'Create session events' }),
    ApiBody({ type: CreateSessionEventsDto }),
  );

export const UpdateSessionEvent = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update Session Event by id' }),
    ApiBody({ type: UpdateSessionEventDto }),
  );
