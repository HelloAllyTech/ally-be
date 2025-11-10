import { Module } from '@nestjs/common';
import { PlaceService } from './service/place.service';
import { PlaceController } from './controller/place.controller';
import { PlaceRepository } from './repository/place.repository';

@Module({
  controllers: [PlaceController],
  providers: [PlaceService, PlaceRepository],
  exports: [PlaceService],
})
export class PlaceModule {}
