import { ExecutionContext } from '@nestjs/common';
import { AuthkeyGuard } from '../authkey.guard';

describe('AuthkeyGuard', () => {
  let guard: AuthkeyGuard;

  beforeEach(() => {
    guard = new AuthkeyGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow request if no x-authkey header is provided', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({}), // mock getResponse
      }),
    } as unknown as ExecutionContext;

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should call super.canActivate if x-authkey header is present', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-authkey': 'somekey' } }),
        getResponse: () => ({}), // mock getResponse
      }),
    } as unknown as ExecutionContext;

    // Mock the parent canActivate to return true
    const parentCanActivateSpy = jest
      .spyOn(Object.getPrototypeOf(guard), 'canActivate')
      .mockReturnValue(true);

    const result = guard.canActivate(context);
    expect(result).toBe(true);
    expect(parentCanActivateSpy).toHaveBeenCalledWith(context);
  });
});
