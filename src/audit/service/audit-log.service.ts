import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLog } from '../entity/audit-log.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AUDIT_EVENTS } from '../constants/audit-event.constants';

export type AuditLogEvent = {
  eventType: keyof typeof AUDIT_EVENTS;
  tenantId?: string;
  userId?: number;
  details?: any;
};

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(event: AuditLogEvent): Promise<void> {
    try {
      const execUserId = ExecutionManager.getUserId();
      const userId = event.userId || (execUserId ? Number(execUserId) : null);
      const tenantId = event.tenantId || ExecutionManager.getTenantId();

      let request;
      try {
        request = ExecutionManager.getRequestMetadata();
      } catch {
        request = null;
      }

      const ipAddress =
        typeof request?.ip === 'string' ? request.ip : 'Unknown';
      const userAgent =
        typeof request?.headers?.['user-agent'] === 'string'
          ? request.headers['user-agent']
          : 'Unknown';

      const auditLog = this.auditLogRepository.create({
        eventType: event.eventType,
        userId: userId && !isNaN(userId) ? userId : undefined,
        tenantId: tenantId || undefined,
        details: event.details,
        ipAddress,
        userAgent,
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error('Failed to save admin audit log to DB', error);
    }
  }

  async listByEventTypes(
    eventTypes: Array<keyof typeof AUDIT_EVENTS>,
    limit = 50,
    offset = 0,
  ): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: {
        eventType: In(eventTypes),
      },
      order: {
        loggedAt: 'DESC',
      },
      take: limit,
      skip: offset,
    });
  }
}
