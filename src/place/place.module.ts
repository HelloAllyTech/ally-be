import { forwardRef, Module } from '@nestjs/common';
import { PlaceService } from './service/place.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place } from './entity/place.entity';
import { PlaceController } from './controller/place.controller';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([Place]), forwardRef(() => UserModule)],
  controllers: [PlaceController],
  providers: [PlaceService],
  exports: [PlaceService],
})
export class PlaceModule {}
