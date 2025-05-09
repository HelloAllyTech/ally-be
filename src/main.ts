import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ExecutionContextInterceptor } from './common/execution/execution-context.interceptor';
import { ExecutionManager } from './common/execution/execution-manager';
import helmet from 'helmet';
import { AudioIngestGateway } from './audio-ingest/gateway/audio.ingest.gateway';
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    const app = await NestFactory.create(AppModule, {
      bufferLogs: true,
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    ExecutionManager.init();
    app.useGlobalInterceptors(new ExecutionContextInterceptor());
    app.use(helmet());
    app.enableCors();
    // remove x-powered-by header
    app.getHttpAdapter().getInstance().disable('x-powered-by');

    const port = process.env.PORT || 3000;

    const config = new DocumentBuilder()
      .setTitle('Lifeline API')
      .setDescription('The Lifeline API description')
      .setVersion('1.0')
      .addTag('lifeline')
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, documentFactory);
    const audioIngestGateway = app.get(AudioIngestGateway);
    const httpServer = app.getHttpServer();
    // Route upgrade requests for `/ws` manually to raw ws
    httpServer.on('upgrade', (request: any, socket: any, head: any) => {
      const { url } = request;

      if (url?.startsWith('/ws')) {
        audioIngestGateway
          .getWss()
          .handleUpgrade(request, socket, head, (ws) => {
            audioIngestGateway.getWss().emit('connection', ws, request);
          });
      }
      // Socket.IO or other upgrades fall through and are handled by Nest/SIO
    });
    await app.listen(port);
    logger.log(`Application is running on: http://localhost:${port}`);
  } catch (error) {
    logger.error('Error starting application:', error);
    throw error;
  }
}

bootstrap().catch((err) => {
  Logger.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
