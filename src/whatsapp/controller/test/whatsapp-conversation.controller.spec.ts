import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { WhatsAppConversationController } from '../whatsapp-conversation.controller';

/**
 * Guards the permission surface of the most sensitive controller this feature defines.
 *
 * These rows hold mental healthcare workers' clinical questions next to their phone numbers, so
 * `:conversations` is granted to SUPER_DUPER_ADMIN alone. That intent lives in a raw-SQL migration
 * which nothing type-checks, and a new route added here without a decorator is authenticated but
 * otherwise open to anyone with a token. So the metadata is asserted directly, per route.
 *
 * The reveal endpoint is checked separately: it is the one call that emits an unmasked phone number,
 * and it must sit behind the EDIT permission rather than the VIEW one. Reading the log is a routine
 * operational act; pulling out a worker's number is not, and collapsing the two would hand it to
 * everyone who can open the tab.
 */
describe('WhatsAppConversationController permissions', () => {
  const permissionsFor = (
    method: keyof WhatsAppConversationController,
  ): string[] => {
    const handler = WhatsAppConversationController.prototype[method];
    const metadata = Reflect.getMetadata(PERMISSIONS_KEY, handler) as
      | { permissions: string[] }
      | undefined;
    return metadata?.permissions ?? [];
  };

  const ROUTES: (keyof WhatsAppConversationController)[] = [
    'listConversations',
    'getConversation',
    'resolveCitation',
    'revealPhone',
    'block',
    'unblock',
    'erase',
    'listUnanswered',
    'updateUnanswered',
    'createDocumentFromUnanswered',
    'overview',
    'timeseries',
    'languages',
    'corpusCoverage',
  ];

  it.each(ROUTES)('%s requires at least one permission', (method) => {
    expect(permissionsFor(method).length).toBeGreaterThan(0);
  });

  it.each(ROUTES)('%s requires only WhatsApp bot permissions', (method) => {
    for (const permission of permissionsFor(method)) {
      expect(permission).toMatch(/whatsapp-bot/);
    }
  });

  describe('phone reveal', () => {
    it('sits behind the EDIT permission, not the VIEW one', () => {
      expect(permissionsFor('revealPhone')).toEqual([
        PERMISSIONS.EDIT_WHATSAPP_BOT_CONVERSATIONS,
      ]);
    });

    it('is not reachable with read-only access to the log', () => {
      // A VIEW-only admin can read the whole thread; that is the point of the masking. What they
      // cannot do is turn a masked row back into an identifiable phone number.
      expect(permissionsFor('listConversations')).toEqual([
        PERMISSIONS.VIEW_WHATSAPP_BOT_CONVERSATIONS,
      ]);
      expect(permissionsFor('revealPhone')).not.toContain(
        PERMISSIONS.VIEW_WHATSAPP_BOT_CONVERSATIONS,
      );
    });

    it('applies the same rule to erasure and blocking', () => {
      for (const method of ['erase', 'block', 'unblock'] as const) {
        expect(permissionsFor(method)).toEqual([
          PERMISSIONS.EDIT_WHATSAPP_BOT_CONVERSATIONS,
        ]);
      }
    });
  });

  describe('queue and analytics separation', () => {
    it('reads the queue and writes to it under different permissions', () => {
      expect(permissionsFor('listUnanswered')).toEqual([
        PERMISSIONS.VIEW_WHATSAPP_BOT_UNANSWERED,
      ]);
      expect(permissionsFor('updateUnanswered')).toEqual([
        PERMISSIONS.EDIT_WHATSAPP_BOT_UNANSWERED,
      ]);
      // Creating corpus material is a write, even though it starts from the queue.
      expect(permissionsFor('createDocumentFromUnanswered')).toEqual([
        PERMISSIONS.EDIT_WHATSAPP_BOT_UNANSWERED,
      ]);
    });

    it('gates the dashboard on the analytics permission alone', () => {
      // Aggregates carry no message bodies and no numbers, so they do not need conversation access —
      // and requiring it would push every dashboard viewer into the most sensitive grant there is.
      for (const method of [
        'overview',
        'timeseries',
        'languages',
        'corpusCoverage',
      ] as const) {
        expect(permissionsFor(method)).toEqual([
          PERMISSIONS.VIEW_WHATSAPP_BOT_ANALYTICS,
        ]);
      }
    });
  });
});
