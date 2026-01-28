import { Module } from '@nestjs/common';
import { PlaceService } from './service/place.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place } from './entity/place.entity';
import { PlaceController } from './controller/place.controller';
import { PlaceRepository } from './repository/place.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Place])],
  controllers: [PlaceController],
  providers: [PlaceService, PlaceRepository],
  exports: [PlaceService],
})
export class PlaceModule {}
