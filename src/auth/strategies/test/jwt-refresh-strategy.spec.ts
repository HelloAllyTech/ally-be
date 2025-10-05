import { AppConfigService } from '../../../config/config.service';
import { JwtRefreshStrategy } from '../jwt-refresh.strategy';

describe('JwtRefreshStrategy', () => {
  let strategy: JwtRefreshStrategy;

  const mockConfigService: Partial<AppConfigService> = {
    jwt: {
      refreshToken: {
        secret: 'refresh-secret',
      },
    } as any,
  };

  beforeEach(() => {
    strategy = new JwtRefreshStrategy(mockConfigService as AppConfigService);
  });

  it('should be defined and construct with config secret', () => {
    expect(strategy).toBeDefined();
    // Indirectly ensures super() received config without throwing
    expect(typeof (strategy as any).name).toBe('string');
  });

  it('validate should return user with refreshToken from request body', async () => {
    const req: any = { body: { refreshToken: 'rt-123' } };
    const payload = { sub: 10, username: 'alice' };

    const result = await strategy.validate(req, payload);

    expect(result).toEqual({
      id: 10,
      username: 'alice',
      refreshToken: 'rt-123',
    });
  });

  it('validate should propagate undefined refreshToken if missing in body', async () => {
    const req: any = { body: {} };
    const payload = { sub: 22, username: 'bob' };

    const result = await strategy.validate(req, payload);

    expect(result).toEqual({
      id: 22,
      username: 'bob',
      refreshToken: undefined,
    });
  });
});
