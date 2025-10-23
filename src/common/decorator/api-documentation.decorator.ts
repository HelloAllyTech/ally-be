import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Place } from '../entities/place.entity';

export const SearchCities = () =>
  applyDecorators(
    ApiOperation({ summary: 'Search for cities' }),
    ApiQuery({ name: 'query', type: String, required: true }),
    ApiResponse({
      status: 200,
      description: 'List of cities',
      type: [Place],
    }),
  );

export const ListPlaces = () =>
  applyDecorators(
    ApiOperation({ summary: 'List all places' }),
    ApiQuery({ name: 'page', type: Number, required: false }),
    ApiQuery({ name: 'limit', type: Number, required: false }),
    ApiResponse({
      status: 200,
      description: 'List of places',
      schema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(Place) } },
          total: { type: 'number' },
        },
      },
    }),
  );
