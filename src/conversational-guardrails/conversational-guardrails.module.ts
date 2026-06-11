import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationalGuardrails } from './entity/conversational-guardrails.entity';
import { ConversationalGuardrailsController } from './controller/conversational-guardrails.controller';
import { ConversationalGuardrailsService } from './service/conversational-guardrails.service';
import { ConversationalGuardrailsRepository } from './repository/conversational-guardrails.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ConversationalGuardrails])],
  controllers: [ConversationalGuardrailsController],
  providers: [
    ConversationalGuardrailsService,
    ConversationalGuardrailsRepository,
  ],
  exports: [ConversationalGuardrailsService],
})
export class ConversationalGuardrailsModule {}
