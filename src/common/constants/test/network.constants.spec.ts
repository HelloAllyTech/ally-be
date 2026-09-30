import { Controller, Get, Req } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import * as request from 'supertest';
import { TRUSTED_PROXY_HOPS } from '../network.constants';

@Controller()
class EchoIpController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

/**
 * What req.ip resolves to behind the load balancer, with the `trust proxy` value main.ts sets.
 *
 * The test client plays the load balancer — it is the TCP peer — and X-Forwarded-For is
 * written the way the balancer leaves it: anything the client sent, then the address the
 * balancer accepted the connection from, appended. Addresses are from the RFC 5737
 * documentation ranges.
 */
describe('TRUSTED_PROXY_HOPS', () => {
  const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;
  let app: NestExpressApplication;

  async function boot(trustProxy?: number) {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoIpController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    if (trustProxy !== undefined) {
      app.set('trust proxy', trustProxy);
    }
    await app.init();
  }

  async function ipFor(xForwardedFor?: string): Promise<string> {
    const get = request(app.getHttpServer()).get('/ip');
    if (xForwardedFor) {
      get.set('X-Forwarded-For', xForwardedFor);
    }
    return (await get.expect(200)).body.ip;
  }

  afterEach(async () => {
    await app?.close();
  });

  describe('as main.ts sets it', () => {
    beforeEach(() => boot(TRUSTED_PROXY_HOPS));

    it('resolves req.ip to the address the load balancer appended', async () => {
      expect(await ipFor('203.0.113.7')).toBe('203.0.113.7');
    });

    it('ignores an address the client wrote into X-Forwarded-For itself', async () => {
      expect(await ipFor('198.51.100.66, 203.0.113.7')).toBe('203.0.113.7');
    });

    it('falls back to the TCP peer when there is no X-Forwarded-For', async () => {
      expect(await ipFor()).toMatch(LOOPBACK);
    });
  });

  it('left unset, resolves every client to the load balancer — how production ran before', async () => {
    await boot();

    expect(await ipFor('203.0.113.7')).toMatch(LOOPBACK);
  });
});
