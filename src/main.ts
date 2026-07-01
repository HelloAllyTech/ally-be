import {
  Logger,
  LogLevel,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bufferLogs: true,
    });
    const appConfigService = app.get(AppConfigService);
    app.enableCors({
      origin: (origin: any, callback: any) => {
        const allowedOrigins = appConfigService.cors.allowedOrigins;
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          Logger.warn(`Blocked CORS request from origin: ${origin}`, 'CORS');
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    });

    // Env-configurable Nest logger levels
    const logLevel = appConfigService.logLevel.toLowerCase();
    const nestLevelsByLevel: Record<string, LogLevel[]> = {
      error: ['error'],
      warn: ['warn', 'error'],
      info: ['log', 'warn', 'error'],
      debug: ['log', 'warn', 'error', 'debug'],
    };
    const defaultLevel = appConfigService.isDevelopment ? 'debug' : 'warn';
    app.useLogger(
      nestLevelsByLevel[logLevel] || nestLevelsByLevel[defaultLevel],
    );

    // Add body parser configuration for larger payloads
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ limit: '1mb', extended: true }));

    // Serve dynamic-i18n published files at /i18n/* (manifest + versioned bundles).
    // Drafts are private and must never be publicly accessible.
    const i18nRoot = appConfigService.i18n.rootDir;
    app.use('/i18n/.drafts', (_req: Request, res: Response) => {
      res.status(404).end();
    });
    app.useStaticAssets(i18nRoot, {
      prefix: '/i18n/',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('manifest.json')) {
          res.setHeader('Cache-Control', 'public, max-age=30, must-revalidate');
        } else if (/[/\\]v\d+[/\\]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });

    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.use(helmet());
    // remove x-powered-by header
    app.getHttpAdapter().getInstance().disable('x-powered-by');

    const port = appConfigService.port;

    const config = new DocumentBuilder()
      .setTitle('Ally API')
      .setDescription('The Ally API description')
      .setVersion('1.0')
      .addTag('ally')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        'access-token',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'x-api-key',
          in: 'header',
          description: 'API key required to access this endpoint',
        },
        'api-key',
      )
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, documentFactory);

    // Run Nest lifecycle hooks (onModuleDestroy / onApplicationShutdown) on
    // SIGTERM/SIGINT. Without this a deploy or scale-in just kills the process,
    // so in-flight live scribe recordings are never flushed to S3 and are lost
    // (short sessions have no completed multipart part to salvage). The
    // microphone gateway drains active recordings in its shutdown hook.
    app.enableShutdownHooks();

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
