import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { HelplineAccess } from '../constants/helpline.constants';

/**
 * Who may read a chat (contract §5.3 / §6.3 JOIN_CHAT):
 *  - the listener of record → LISTENER
 *  - a previous listener (transfer / take-over) → READ_ONLY
 *  - anyone holding `view:helpline:monitor` → READ_ONLY
 *  - anyone else → null, which callers turn into a 404 (never a 403, so the
 *    chat's existence is not confirmed).
 *
 * Tenant isolation is NOT decided here: the chat must already have been loaded
 * with the caller's tenant in the WHERE clause.
 */
export function resolveChatAccess(
  chat: { listenerId: number | null; previousListenerIds: number[] | null },
  userId: number,
  permissions: readonly string[],
): HelplineAccess | null {
  if (chat.listenerId != null && chat.listenerId === userId) {
    return HelplineAccess.LISTENER;
  }
  if ((chat.previousListenerIds ?? []).includes(userId)) {
    return HelplineAccess.READ_ONLY;
  }
  if (permissions.includes(PERMISSIONS.VIEW_HELPLINE_MONITOR)) {
    return HelplineAccess.READ_ONLY;
  }
  return null;
}
