export abstract class SMSInterface {
  abstract sendSMS: (to: string, body: string) => Promise<void>;
  abstract sendOTP: (to: string, otp: string) => Promise<void>;
}
