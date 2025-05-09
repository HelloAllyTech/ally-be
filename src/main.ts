import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
    audioIngestGateway.initialize(app.getHttpServer());

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
