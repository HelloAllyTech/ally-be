import { createLogger, Logger } from 'winston';
import * as WinstonCloudWatch from 'winston-cloudwatch';
import * as net from 'net';
import * as geoip from 'fast-geoip';
import { AUDIT_EVENTS } from '../constants/audit-event.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';

type AuditLogEvent = {
  eventType: keyof typeof AUDIT_EVENTS;
  tenantId?: string;
  userId?: number;
  loggedAt?: Date;
  details?: {
    [key: string]: any;
  };
};

export class AuditLoggerService {
  private readonly auditLogger: Logger | null;
  private static instance: AuditLoggerService;

  constructor() {
    this.auditLogger = AuditLoggerService.createAuditLogger();
  }

  static getInstance(): AuditLoggerService {
    if (!AuditLoggerService.instance) {
      AuditLoggerService.instance = new AuditLoggerService();
    }
    return AuditLoggerService.instance;
  }

  private static createAuditLogger(): Logger | null {
    const enableHippaLogs =
      process.env.ENABLE_AUDIT_LOGS_TO_CLOUDWATCH === 'true';

    // If HIPPA logs are disabled, return null - we'll use direct console.log
    if (!enableHippaLogs) {
      return null;
    }

    // If HIPPA logs are enabled, use CloudWatch
    const randomId = Math.floor(Math.random() * 1000000);
    const baseStreamName = process.env.CLOUDWATCH_HIPAA_LOG_STREAM_NAME;
    const streamName = `${baseStreamName}-${randomId}`;

    return createLogger({
      transports: [
        new (WinstonCloudWatch as any)({
          logGroupName: process.env.CLOUDWATCH_HIPAA_LOG_GROUP_NAME,
          logStreamName: streamName,
          awsRegion: process.env.AWS_REGION,
          jsonMessage: true,
          uploadRate: 5000, // Upload every 5 seconds
          errorHandler: (err: any) => {
            console.error('CloudWatch audit logging error:', err);
          },
        }),
      ],
      exitOnError: false,
    });
  }

  async log(event: AuditLogEvent): Promise<void> {
    try {
      const eventId = ExecutionManager.getExecutionId();

      const userId = ExecutionManager.getUserId() || event.userId;
      const tenantId = ExecutionManager.getTenantId() || event.tenantId;
      const request = ExecutionManager.getRequestMetadata();

      const ip = request?.ip || 'Unknown';
      const userAgent = request?.headers?.['user-agent'] || 'Unknown';
      const httpMethod = request?.method || 'WebSocket';
      const endpoint = request?.originalUrl || 'WebSocket Connection';
      const requestId =
        request?.headers?.['x-request-id'] || eventId || 'Unknown';

      const isValidIp = ip !== 'Unknown' && net.isIP(ip);
      const geo = isValidIp ? await geoip.lookup(ip) : null;
      const location = geo ? `${geo.city}, ${geo.country}` : 'Unknown';
      const loggedAt = event.loggedAt ? event.loggedAt : new Date();

      const auditLogDto = {
        ...event,
        userId,
        tenantId,
        auditId: eventId,
        loggedAt,
        details: {
          ...event.details,
          ip,
          location,
          userAgent,
          httpMethod,
          endpoint,
          requestId,
        },
      };

      // If auditLogger is null, use direct console.log (when CloudWatch is disabled)
      if (process.env.ENABLE_CONSOLE_AUDIT_LOGS === 'true') {
        console.log('🔍 AUDIT LOG:', JSON.stringify(auditLogDto, null, 2));
      }
      if (this.auditLogger !== null) {
        this.auditLogger.info(auditLogDto);
      }
    } catch (error) {
      console.error('Error while creating audit log for the event', error);
    }
  }
}
