import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { PlaceService } from '../service/place.service';
import { Place } from '../entities/place.entity';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiTags('Places')
@Controller('v1/places')
export class PlaceController {
  constructor(private readonly placeService: PlaceService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search for cities' })
  @ApiQuery({ name: 'query', type: String, required: true })
  @ApiResponse({
    status: 200,
    description: 'List of cities',
    type: [Place],
  })
  async searchCities(@Query('query') query: string): Promise<Place[]> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Query parameter cannot be empty');
    }
    if (query.length > 100) {
      throw new BadRequestException('Query parameter too long');
    }
    return this.placeService.searchCities(query);
  }

  @Get()
  @ApiOperation({ summary: 'List all places' })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiResponse({
    status: 200,
    description: 'List of places',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(Place) } },
        total: { type: 'number' },
      },
    },
  })
  @AuthPermissions([PERMISSIONS.VIEW_PLACES])
  async listPlaces(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<{ data: Place[]; total: number }> {
    if (page < 1) {
      throw new BadRequestException('Page must be greater than or equal to 1');
    }
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('Limit must be between 1 and 100');
    }
    return this.placeService.listPlaces(page, limit);
  }
}
