import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from '../aws/aws.module';
import { ScenarioCoverImageLibrary } from './entity/scenario-cover-image-library.entity';
import { ScenarioCoverImageLibraryRepository } from './repository/scenario-cover-image-library.repository';
import { ScenarioCoverImageLibraryService } from './service/scenario-cover-image-library.service';
import { ScenarioCoverImageLibraryController } from './controller/scenario-cover-image-library.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ScenarioCoverImageLibrary]), AwsModule],
  controllers: [ScenarioCoverImageLibraryController],
  providers: [
    ScenarioCoverImageLibraryRepository,
    ScenarioCoverImageLibraryService,
  ],
})
export class ScenarioCoverImageLibraryModule {}
