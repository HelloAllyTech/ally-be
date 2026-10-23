import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { FaviconController } from './favicon.controller';

describe('FaviconController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [FaviconController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return 204 No Content for /favicon.ico', () => {
    return request(app.getHttpServer()).get('/favicon.ico').expect(204);
  });
});
