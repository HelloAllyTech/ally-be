import { Injectable } from '@nestjs/common';
import { SMSInterface } from '../interface/sms.interface';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import axios from 'axios';
import { MSG91_SMS_DTO } from '../dto/sms.dto';
import { SlackService } from './slack.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class Msg91Service implements SMSInterface {
  private readonly apiKey: string;
  private readonly otpTemplateId: string;
  private readonly apiUrl: string;

  private readonly logger = LoggerService.getInstance(Msg91Service.name);
  constructor(
    private readonly config: AppConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.apiKey = config.sms.msg91.apiKey;
    this.otpTemplateId = config.sms.msg91.templateId;
    this.apiUrl = config.sms.msg91.apiUrl;
  }
  async sendOTP(to: string, otp: string): Promise<void> {
    this.logger.info(`Sending OTP to ${to}`);
    // const data = {
    //   template_id: this.otpTemplateId,
    //   recipients: [{ mobiles: to, OTP: otp }],
    // };
    // const response = await this.makeRequest<MSG91_SMS_DTO>(this.apiUrl, data);
    // this.logger.info(`OTP sent to ${to} - ${response?.message}`);
    // for debugging
    this.eventEmitter.emit('exception', {
      statusCode: 200,
      timestamp: new Date().toISOString(),
      path: '/api/v1/sms/otp',
      message: 'OTP sent to ' + to + ' - ' + otp,
      type: 'SMS OTP',
    });
    return;
  }

  async sendSMS(to: string, body: string): Promise<void> {
    this.logger.info(`Sending SMS to ${to} with body ${body}`);
    return;
  }

  async makeRequest<T>(url: string, data: T): Promise<any> {
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  }
}
