import * as crypto from 'crypto';
import { AuthUtil } from '../auth.util';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

describe('AuthUtil', () => {
  describe('generateOtp', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should generate a 6-digit OTP', () => {
      const otp = AuthUtil.generateOtp();

      expect(otp).toBeDefined();
      expect(typeof otp).toBe('string');
      expect(otp.length).toBe(6);
    });

    it('should generate OTP within valid range (100000-999999)', () => {
      const otp = AuthUtil.generateOtp();
      const otpNumber = parseInt(otp, 10);

      expect(otpNumber).toBeGreaterThanOrEqual(100000);
      expect(otpNumber).toBeLessThanOrEqual(999999);
    });

    it('should generate numeric string only', () => {
      const otp = AuthUtil.generateOtp();

      expect(/^\d{6}$/.test(otp)).toBe(true);
    });

    it('should generate different OTPs on multiple calls', () => {
      const otps = new Set<string>();

      // Generate 100 OTPs and check for variety
      for (let i = 0; i < 100; i++) {
        otps.add(AuthUtil.generateOtp());
      }

      // At least some should be different (very high probability)
      expect(otps.size).toBeGreaterThan(1);
    });

    it('draws from the CSPRNG over every 6-digit code, never Math.random', () => {
      const mathRandom = jest.spyOn(Math, 'random');

      AuthUtil.generateOtp();

      // randomInt's upper bound is exclusive: 100000..999999 inclusive.
      expect(crypto.randomInt).toHaveBeenCalledWith(100000, 1000000);
      expect(mathRandom).not.toHaveBeenCalled();
    });
  });
});
