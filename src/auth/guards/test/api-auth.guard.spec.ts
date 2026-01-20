import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { ApiAuthGuard } from '../api-auth.guard';
import { AppConfigService } from 'src/config/config.service';

describe('ApiAuthGuard', () => {
  let guard: ApiAuthGuard;

  const mockAppConfigService = {
    apiKey: 'valid-api-key',
  } as AppConfigService;

  const mockExecutionContext = (headers = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    guard = new ApiAuthGuard(mockAppConfigService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow request when API key is valid', () => {
    const context = mockExecutionContext({
      'x-api-key': 'valid-api-key',
    });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should throw UnauthorizedException when API key is missing', () => {
    const context = mockExecutionContext({});

    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('API key missing'),
    );
  });

  it('should throw UnauthorizedException when API key is invalid', () => {
    const context = mockExecutionContext({
      'x-api-key': 'invalid-api-key',
    });

    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid API key'),
    );
  });
});
