import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

export const HandleOzonetelCallDetails = () =>
  applyDecorators(
    ApiOperation({ summary: 'Handle Ozonetel call details webhook' }),
    ApiResponse({
      status: 200,
      description: 'Ozonetel call details processed successfully',
    }),
  );

export const HandleOzonetelEventsSubscription = () =>
  applyDecorators(
    ApiOperation({ summary: 'Handle Ozonetel events subscription' }),
    ApiResponse({
      status: 200,
      description: 'Ozonetel events subscription processed successfully',
    }),
  );

export const SubscribeOzonetelEvents = () =>
  ApiOperation({ summary: 'Subscribe Ozonetel events' });

export const UnsubscribeOzonetelEvents = () =>
  ApiOperation({ summary: 'Unsubscribe Ozonetel events' });
