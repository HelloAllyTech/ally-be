export class AuthUtil {
  private static readonly OTP_LENGTH = 4;
  private static readonly OTP_MIN = 10 ** (this.OTP_LENGTH - 1);
  private static readonly OTP_MAX = 9 * 10 ** (this.OTP_LENGTH - 1);
  public static generateOtp() {
    const otp = Math.floor(
      this.OTP_MIN + Math.random() * this.OTP_MAX,
    ).toString();
    return otp;
  }
}
