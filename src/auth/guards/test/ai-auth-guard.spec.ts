import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { AppConfigService } from '../../../config/config.service';
import { AiApiKeyGuard } from '../ai-auth.guard';

describe('AiApiKeyGuard', () => {
  let guard: AiApiKeyGuard;

  const mockConfig: Partial<AppConfigService> = {
    ai: {
      apiKey: 'secret-key',
    } as any,
  };

  // Helper to build a mocked ExecutionContext with custom headers
  const makeContext = (
    headers: Record<string, string | undefined>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
      switchToRpc: () => ({}),
      switchToWs: () => ({}),
      getClass: () => ({}) as any,
      getHandler: () => ({}) as any,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      getType: () => 'http',
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    guard = new AiApiKeyGuard(mockConfig as AppConfigService);
  });

  it('allows request when x-api-key matches config', () => {
    const ctx = makeContext({ 'x-api-key': 'secret-key' });

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
  });

  it('throws UnauthorizedException when x-api-key header missing', () => {
    const ctx = makeContext({});

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid API key');
  });

  it('throws UnauthorizedException when x-api-key is incorrect', () => {
    const ctx = makeContext({ 'x-api-key': 'wrong-key' });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid API key');
  });
});
