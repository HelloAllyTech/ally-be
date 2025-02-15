import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { validationSchema } from './config/env.validation';
import authConfig from './config/auth.config';
import { AppConfigModule } from './config/config.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ChatModule } from './chat/chat.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { UserModule } from './user/user.module';
import { QueueModule } from './queue/queue.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [authConfig],
      validationSchema,
    }),
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    ChatModule,
    HealthModule,
    EventEmitterModule.forRoot(),
    UserModule,
    QueueModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
