export abstract class EmailInterface {
  abstract sendEmail(params: {
    from?: string;
    to: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
  }): Promise<boolean>;

  abstract sendEmailOTP(params: { to: string; otp: string }): Promise<boolean>;
}
