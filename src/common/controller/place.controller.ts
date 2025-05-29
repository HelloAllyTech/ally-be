import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
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
  async listPlaces(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.placeService.listPlaces(page, limit);
  }
}
