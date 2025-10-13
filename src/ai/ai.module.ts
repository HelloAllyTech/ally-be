import { Module, forwardRef } from '@nestjs/common';
import { AiService } from './service/ai.service';
import { AiEventService } from './service/ai-event.service';
import { AiEventConsumer } from './consumer/ai-event.consumer';
import { DeepgramService } from './service/deepgram.service';
import { TranscriptionService } from './service/transcription.service';
import { SqsService } from '../aws/service/sqs.service';
import { ChatModule } from '../chat/chat.module';
import { ProcessorRegistry } from './processors/processor-registry';
import { TranscribeResultProcessor } from './processors/transcribe-result.processor';
import { UnknownEventProcessor } from './processors/unknown-event.processor';
import { TranscriptionRequestDlqConsumer } from './consumer/transcription-request-dlq.consumer';
import { TranscriptionResponseDlqConsumer } from './consumer/transcription-response-dlq.consumer';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [forwardRef(() => ChatModule), forwardRef(() => LearnModule)],
  providers: [
    AiService,
    AiEventService,
    AiEventConsumer,
    { provide: 'transcriptionService', useClass: DeepgramService },
    TranscriptionService,
    SqsService,
    ProcessorRegistry,
    TranscribeResultProcessor,
    UnknownEventProcessor,
    TranscriptionRequestDlqConsumer,
    TranscriptionResponseDlqConsumer,
  ],
  exports: [AiService, AiEventService, TranscriptionService, ProcessorRegistry],
})
export class AiModule {}
