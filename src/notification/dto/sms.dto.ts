export type MSG91_SMS_DTO = {
  template_id: string;
  recipients: {
    mobiles: string;
    [key: string]: string;
  }[];
};
