import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScenarioCharacter } from './entity/scenario-character.entity';
import { ScenarioCharacterController } from './controller/scenario-character.controller';
import { ScenarioCharacterService } from './service/scenario-character.service';
import { ScenarioCharacterRepository } from './repository/scenario-character.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScenarioCharacter, ScenarioCharacterRepository]),
  ],
  controllers: [ScenarioCharacterController],
  providers: [ScenarioCharacterService, ScenarioCharacterRepository],
  exports: [ScenarioCharacterService],
})
export class ScenarioCharacterModule {}
