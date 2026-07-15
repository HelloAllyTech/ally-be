import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from '../aws/aws.module';
import { ImageGenerationModule } from '../image-generation/image-generation.module';
import { LlmUsageModule } from '../analytics/llm-usage.module';
import { PromptModule } from '../prompt/prompt.module';
import { ScenarioCoverImageLibrary } from './entity/scenario-cover-image-library.entity';
import { ScenarioCoverImageLibraryRepository } from './repository/scenario-cover-image-library.repository';
import { ScenarioCoverImageLibraryService } from './service/scenario-cover-image-library.service';
import { ScenarioCoverImageLibraryController } from './controller/scenario-cover-image-library.controller';
import { CoverImageGenerationService } from './service/cover-image-generation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScenarioCoverImageLibrary]),
    AwsModule,
    ImageGenerationModule,
    LlmUsageModule,
    PromptModule,
  ],
  controllers: [ScenarioCoverImageLibraryController],
  providers: [
    ScenarioCoverImageLibraryRepository,
    ScenarioCoverImageLibraryService,
    CoverImageGenerationService,
  ],
})
export class ScenarioCoverImageLibraryModule {}
