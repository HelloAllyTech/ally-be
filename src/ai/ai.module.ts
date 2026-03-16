import { Module, forwardRef } from '@nestjs/common';
import { AiService } from './service/ai.service';
import { AiEventService } from './service/ai-event.service';
import { AiEventConsumer } from './consumer/ai-event.consumer';
import { SqsService } from '../aws/service/sqs.service';
import { ChatModule } from '../chat/chat.module';
import { ProcessorRegistry } from './processors/processor-registry';
import { TranscribeResultProcessor } from './processors/transcribe-result.processor';
import { UnknownEventProcessor } from './processors/unknown-event.processor';
import { TranscriptionRequestDlqConsumer } from './consumer/transcription-request-dlq.consumer';
import { TranscriptionResponseDlqConsumer } from './consumer/transcription-response-dlq.consumer';
import { LearnModule } from 'src/learn/learn.module';
import { PromptModule } from '../prompt/prompt.module';

@Module({
  imports: [
    forwardRef(() => ChatModule),
    forwardRef(() => LearnModule),
    PromptModule,
  ],
  providers: [
    AiService,
    AiEventService,
    AiEventConsumer,
    SqsService,
    ProcessorRegistry,
    TranscribeResultProcessor,
    UnknownEventProcessor,
    TranscriptionRequestDlqConsumer,
    TranscriptionResponseDlqConsumer,
  ],
  exports: [AiService, AiEventService, ProcessorRegistry],
})
export class AiModule {}
