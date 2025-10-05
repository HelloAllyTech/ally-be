import { AuthUtil } from '../auth.util';

describe('AuthUtil', () => {
  describe('generateOtp', () => {
    it('should generate a 4-digit OTP', () => {
      const otp = AuthUtil.generateOtp();

      expect(otp).toBeDefined();
      expect(typeof otp).toBe('string');
      expect(otp.length).toBe(4);
    });

    it('should generate OTP within valid range (1000-9999)', () => {
      const otp = AuthUtil.generateOtp();
      const otpNumber = parseInt(otp, 10);

      expect(otpNumber).toBeGreaterThanOrEqual(1000);
      expect(otpNumber).toBeLessThanOrEqual(9999);
    });

    it('should generate numeric string only', () => {
      const otp = AuthUtil.generateOtp();

      expect(/^\d{4}$/.test(otp)).toBe(true);
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

    it('should generate OTP with correct minimum value', () => {
      // Mock Math.random to return 0 to test minimum boundary
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const otp = AuthUtil.generateOtp();
      const otpNumber = parseInt(otp, 10);

      expect(otpNumber).toBe(1000);

      jest.restoreAllMocks();
    });

    it('should generate OTP with correct maximum value', () => {
      // Mock Math.random to return close to 1 to test maximum boundary
      jest.spyOn(Math, 'random').mockReturnValue(0.9999);

      const otp = AuthUtil.generateOtp();
      const otpNumber = parseInt(otp, 10);

      expect(otpNumber).toBeLessThanOrEqual(9999);
      expect(otpNumber).toBeGreaterThanOrEqual(1000);

      jest.restoreAllMocks();
    });
  });
});
