import { testCipher } from '../../service/test/helpline-test-cipher';
import {
  HelplineChatStatus,
  HelplineRiskFlagLevel,
} from '../../constants/helpline.constants';
import { HelplineChatRepository } from '../helpline-chat.repository';
import { HelplineMessageRepository } from '../helpline-message.repository';

/**
 * Every helpline repository query must carry the tenant (CLAUDE.md: "a query
 * without tenant isolation is a data leak"). This drives each method against a
 * recording fake and checks the tenant id reaches the WHERE clause — as a find
 * condition, a raw-SQL parameter next to a `"tenant_id" =` predicate, or a
 * query-builder `tenantId` condition.
 */
const TENANT = 'tenant-under-test';
const CHAT_ID = '11111111-1111-4111-8111-111111111111';

type Call = { method: string; args: unknown[] };

function recordingRepo() {
  const calls: Call[] = [];
  const qbCalls: Call[] = [];
  const qb: Record<string, unknown> = {};
  for (const name of [
    'where',
    'andWhere',
    'orWhere',
    'distinctOn',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'select',
  ]) {
    qb[name] = (...args: unknown[]) => {
      qbCalls.push({ method: name, args });
      return qb;
    };
  }
  qb.getMany = async () => [];
  qb.getManyAndCount = async () => [[], 0];
  qb.getCount = async () => 0;
  qb.getRawOne = async () => ({ max: 0 });

  const record =
    (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  const repo = {
    findOne: record('findOne', null),
    find: record('find', []),
    count: record('count', 0),
    update: record('update', { affected: 0 }),
    query: record('query', [[], 0]),
    save: record('save', {}),
    create: (x: unknown) => x,
    createQueryBuilder: () => {
      calls.push({ method: 'createQueryBuilder', args: [] });
      return qb;
    },
  };
  return { repo, calls, qbCalls };
}

/** Does this one call constrain the tenant? */
function scopesTenant(call: Call, qbCalls: Call[]): boolean {
  const mentions = (value: unknown): boolean => {
    if (value === TENANT) return true;
    if (Array.isArray(value)) return value.length > 0 && value.every(mentions);
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (obj.tenantId === TENANT) return true;
      if ('where' in obj) return mentions(obj.where);
    }
    return false;
  };
  switch (call.method) {
    case 'query': {
      const [sql, params] = call.args as [string, unknown[]];
      return /"tenant_id" = \$\d/.test(sql) && (params ?? []).includes(TENANT);
    }
    case 'createQueryBuilder':
      return qbCalls.some(
        (c) =>
          /tenantId = :tenantId/.test(String(c.args[0])) &&
          (c.args[1] as { tenantId?: string })?.tenantId === TENANT,
      );
    case 'update':
      return mentions(call.args[0]);
    case 'save':
      return (call.args[0] as { tenantId?: string })?.tenantId === TENANT;
    default:
      return mentions(call.args[0]);
  }
}

const chatLike = {
  id: CHAT_ID,
  tenantId: TENANT,
  priority: 0,
  waitStartedAt: new Date(),
} as never;

const chatMethods: [string, (r: HelplineChatRepository) => Promise<unknown>][] =
  [
    ['findById', (r) => r.findById(TENANT, CHAT_ID)],
    ['findForGuest', (r) => r.findForGuest(TENANT, CHAT_ID, 'talker')],
    ['save', (r) => r.save(chatLike)],
    ['claim', (r) => r.claim(TENANT, CHAT_ID, 7)],
    [
      'markEnded',
      (r) => r.markEnded(TENANT, CHAT_ID, 'LISTENER_ENDED' as never, 7),
    ],
    [
      'raiseRisk',
      (r) => r.raiseRisk(TENANT, CHAT_ID, HelplineRiskFlagLevel.HIGH),
    ],
    ['recordTalkerMessage', (r) => r.recordTalkerMessage(TENANT, CHAT_ID)],
    ['recordListenerMessage', (r) => r.recordListenerMessage(TENANT, CHAT_ID)],
    ['recordNudge', (r) => r.recordNudge(TENANT, CHAT_ID)],
    ['markResourcesSent', (r) => r.markResourcesSent(TENANT, CHAT_ID)],
    ['requestTransfer', (r) => r.requestTransfer(TENANT, CHAT_ID, 7, null)],
    ['assignTarget', (r) => r.assignTarget(TENANT, CHAT_ID, 8)],
    ['takeOver', (r) => r.takeOver(TENANT, CHAT_ID, 9)],
    ['listOpenForTalker', (r) => r.listOpenForTalker(TENANT, 'talker-1')],
    ['setAbandoned', (r) => r.setAbandoned(TENANT, CHAT_ID, new Date())],
    ['queuePosition', (r) => r.queuePosition(TENANT, chatLike)],
    ['listQueue', (r) => r.listQueue(TENANT)],
    ['countWaiting', (r) => r.countWaiting(TENANT)],
    ['countActive', (r) => r.countActive(TENANT)],
    ['countActiveForListener', (r) => r.countActiveForListener(TENANT, 7)],
    ['listActiveForListener', (r) => r.listActiveForListener(TENANT, 7)],
    ['listOpen', (r) => r.listOpen(TENANT)],
    ['listActive', (r) => r.listActive(TENANT)],
    ['claimQa', (r) => r.claimQa(TENANT, CHAT_ID)],
    ['recordQaFailure', (r) => r.recordQaFailure(TENANT, CHAT_ID, 3)],
    ['setQaStatus', (r) => r.setQaStatus(TENANT, CHAT_ID, 'DONE' as never)],
    [
      'recentClaimWaitSeconds',
      (r) => r.recentClaimWaitSeconds(TENANT, new Date()),
    ],
    [
      'listPage',
      (r) =>
        r.listPage(
          TENANT,
          { mineFor: 7, status: HelplineChatStatus.ENDED },
          0,
          25,
        ),
    ],
    ['markErased', (r) => r.markErased(TENANT, [CHAT_ID])],
    [
      'findRetentionCandidates',
      (r) => r.findRetentionCandidates(TENANT, new Date(), 500),
    ],
  ];

const messageMethods: [
  string,
  (r: HelplineMessageRepository) => Promise<unknown>,
][] = [
  [
    'findByClientMessageId',
    (r) => r.findByClientMessageId(TENANT, CHAT_ID, 'c'),
  ],
  ['findById', (r) => r.findById(TENANT, CHAT_ID, 1)],
  ['findByIds', (r) => r.findByIds(TENANT, [1, 2])],
  ['insert', (r) => r.insert({ tenantId: TENANT, chatId: CHAT_ID })],
  ['listForChat', (r) => r.listForChat(TENANT, CHAT_ID, 0)],
  ['listTalkerVisible', (r) => r.listTalkerVisible(TENANT, CHAT_ID, 0)],
  ['listTextTurns', (r) => r.listTextTurns(TENANT, CHAT_ID)],
  ['recentTextTurns', (r) => r.recentTextTurns(TENANT, CHAT_ID, 12)],
  ['latestOfType', (r) => r.latestOfType(TENANT, CHAT_ID, 'STAGE' as never)],
  [
    'markSuggestionAccepted',
    (r) => r.markSuggestionAccepted(TENANT, CHAT_ID, 5, 0),
  ],
  [
    'setCopilotFeedback',
    (r) =>
      r.setCopilotFeedback(TENANT, CHAT_ID, 5, 'NUDGE' as never, null, 'UP'),
  ],
  ['firstTalkerTexts', (r) => r.firstTalkerTexts(TENANT, [CHAT_ID])],
  ['listRiskMarkers', (r) => r.listRiskMarkers(TENANT, CHAT_ID, 5)],
  ['maxId', (r) => r.maxId(TENANT, CHAT_ID)],
  ['blankForChats', (r) => r.blankForChats(TENANT, [CHAT_ID])],
];

describe('helpline tenant isolation', () => {
  describe('HelplineChatRepository', () => {
    it.each(chatMethods)(
      '%s scopes every query to the tenant',
      async (_, invoke) => {
        const { repo, calls, qbCalls } = recordingRepo();
        await invoke(new HelplineChatRepository(repo as never));
        const queries = calls.filter((c) => c.method !== 'create');
        expect(queries.length).toBeGreaterThan(0);
        for (const call of queries)
          expect([call.method, scopesTenant(call, qbCalls)]).toEqual([
            call.method,
            true,
          ]);
      },
    );

    it('every OR branch of listQueue / listOpen carries the tenant', async () => {
      for (const invoke of [
        (r: HelplineChatRepository) => r.listQueue(TENANT),
        (r: HelplineChatRepository) => r.listOpen(TENANT),
      ]) {
        const { repo, calls } = recordingRepo();
        await invoke(new HelplineChatRepository(repo as never));
        const where = (calls[0].args[0] as { where: { tenantId: string }[] })
          .where;
        expect(where.length).toBeGreaterThan(1);
        for (const branch of where) expect(branch.tenantId).toBe(TENANT);
      }
    });

    it('the only cross-tenant reads are the named sweeps, returning ids', async () => {
      const own = Object.getOwnPropertyNames(
        HelplineChatRepository.prototype,
      ).filter((name) => name !== 'constructor');
      const covered = new Set(chatMethods.map(([name]) => name));
      const uncovered = own.filter((name) => !covered.has(name));
      expect(uncovered.sort()).toEqual([
        'create',
        'findQaCandidatesAcrossTenants',
        'listOpenTenantIdsAcrossTenants',
        'listRetentionTenantIdsAcrossTenants',
      ]);
    });
  });

  describe('HelplineMessageRepository', () => {
    it.each(messageMethods)(
      '%s scopes every query to the tenant',
      async (_, invoke) => {
        const { repo, calls, qbCalls } = recordingRepo();
        await invoke(
          new HelplineMessageRepository(repo as never, testCipher()),
        );
        const queries = calls.filter((c) => c.method !== 'create');
        expect(queries.length).toBeGreaterThan(0);
        for (const call of queries)
          expect([call.method, scopesTenant(call, qbCalls)]).toEqual([
            call.method,
            true,
          ]);
      },
    );

    it('covers every method', () => {
      const own = Object.getOwnPropertyNames(
        HelplineMessageRepository.prototype,
      ).filter((name) => name !== 'constructor');
      expect(own.sort()).toEqual(messageMethods.map(([name]) => name).sort());
    });

    it('refuses to insert a row without a tenant', async () => {
      const { repo } = recordingRepo();
      await expect(
        new HelplineMessageRepository(repo as never, testCipher()).insert({
          chatId: CHAT_ID,
        }),
      ).rejects.toThrow(/tenant_id/);
    });
  });
});
