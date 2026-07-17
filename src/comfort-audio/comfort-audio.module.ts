import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from '../aws/aws.module';
import { ComfortAudioTrack } from './entity/comfort-audio-track.entity';
import { ComfortAudioTrackRepository } from './repository/comfort-audio-track.repository';
import { ComfortAudioService } from './service/comfort-audio.service';
import { ComfortAudioController } from './controller/comfort-audio.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ComfortAudioTrack]), AwsModule],
  controllers: [ComfortAudioController],
  providers: [ComfortAudioTrackRepository, ComfortAudioService],
})
export class ComfortAudioModule {}
