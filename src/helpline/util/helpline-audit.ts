import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';

type HelplineAuditEvent = Extract<
  keyof typeof AUDIT_EVENTS,
  `HELPLINE_${string}`
>;

/**
 * HIPAA audit for the helpline (contract §10). `details` carry ids, levels,
 * reasons and counts — never a message body. The one sanctioned exception is
 * the matched `signal` on HELPLINE_RISK_FLAGGED (invariant 5): this logger is
 * the designated sink for it. Fire-and-forget; an audit failure must never
 * fail the action it records.
 */
export function helplineAudit(
  eventType: HelplineAuditEvent,
  tenantId: string,
  details: Record<string, string | number | boolean | null>,
  userId?: number | null,
): void {
  void AuditLoggerService.getInstance()
    .log({
      eventType,
      tenantId,
      ...(userId ? { userId } : {}),
      details,
    })
    .catch(() => undefined);
}
