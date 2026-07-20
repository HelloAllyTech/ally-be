import { Brackets, SelectQueryBuilder } from 'typeorm';
import { applyFieldFilters } from '../field-filter-query';
import { Chat } from '../../entity/chat.entity';
import {
  CustomFieldDefinition,
  CustomFieldFillMode,
  CustomFieldType,
} from '../../../custom-fields/entity/custom-field-definition.entity';

interface CapturedWhere {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Minimal SelectQueryBuilder stand-in that records every andWhere() call,
 * unwrapping Brackets so the inner EXISTS clause is captured too.
 */
function makeQueryMock(): {
  qb: SelectQueryBuilder<Chat>;
  captured: CapturedWhere[];
} {
  const captured: CapturedWhere[] = [];

  const record = (arg: string | Brackets, params?: Record<string, unknown>) => {
    if (arg instanceof Brackets) {
      const inner = {
        where: (sql: string, p?: Record<string, unknown>) => {
          captured.push({ sql, params: p ?? {} });
          return inner;
        },
        andWhere: (sql: string, p?: Record<string, unknown>) => {
          captured.push({ sql, params: p ?? {} });
          return inner;
        },
      };
      (arg as unknown as { whereFactory: (qb: unknown) => void }).whereFactory(
        inner,
      );
    } else {
      captured.push({ sql: arg, params: params ?? {} });
    }
  };

  const qb = {
    andWhere: (arg: string | Brackets, params?: Record<string, unknown>) => {
      record(arg, params);
      return qb;
    },
  } as unknown as SelectQueryBuilder<Chat>;

  return { qb, captured };
}

function def(overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: 'def-1',
    name: 'Field',
    fieldType: CustomFieldType.TEXT,
    fillMode: CustomFieldFillMode.MANUAL,
    filterable: true,
    isActive: true,
    ...overrides,
  } as CustomFieldDefinition;
}

const TENANT = 'tenant-1';

describe('applyFieldFilters', () => {
  it('does nothing when there are no filters', () => {
    const { qb, captured } = makeQueryMock();
    applyFieldFilters(qb, undefined, new Map(), TENANT);
    applyFieldFilters(qb, [], new Map(), TENANT);
    expect(captured).toHaveLength(0);
  });

  it('skips filters whose definition is missing, inactive, or not filterable', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map<string, CustomFieldDefinition>([
      ['inactive', def({ id: 'inactive', isActive: false })],
      ['nofilter', def({ id: 'nofilter', filterable: false })],
    ]);
    applyFieldFilters(
      qb,
      [
        { fieldDefinitionId: 'missing', value: 'x' },
        { fieldDefinitionId: 'inactive', value: 'x' },
        { fieldDefinitionId: 'nofilter', value: 'x' },
      ],
      map,
      TENANT,
    );
    expect(captured).toHaveLength(0);
  });

  it('skips empty/whitespace values', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([['def-1', def({})]]);
    applyFieldFilters(
      qb,
      [
        { fieldDefinitionId: 'def-1', value: '   ' },
        { fieldDefinitionId: 'def-1', value: [] },
      ],
      map,
      TENANT,
    );
    expect(captured).toHaveLength(0);
  });

  it('builds an ILIKE EXISTS clause for TEXT fields', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([['def-1', def({ fieldType: CustomFieldType.TEXT })]]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: 'anx' }],
      map,
      TENANT,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toContain('chat_custom_field_values');
    expect(captured[0].sql).toContain('ILIKE');
    expect(captured[0].sql).toContain('.tenant_id =');
    expect(Object.values(captured[0].params)).toContain('%anx%');
    expect(Object.values(captured[0].params)).toContain(TENANT);
    expect(Object.values(captured[0].params)).toContain('def-1');
  });

  it('uses = ANY for SINGLE_SELECT with the selected ids', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      ['def-1', def({ fieldType: CustomFieldType.SINGLE_SELECT })],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: ['a', 'b'] }],
      map,
      TENANT,
    );
    expect(captured[0].sql).toContain('= ANY(');
    expect(Object.values(captured[0].params)).toContainEqual(['a', 'b']);
  });

  it('uses jsonb_exists_any for MULTI_SELECT', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      ['def-1', def({ fieldType: CustomFieldType.MULTI_SELECT })],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: ['x', 'y'] }],
      map,
      TENANT,
    );
    expect(captured[0].sql).toContain('jsonb_exists_any');
  });

  it('builds a numeric range for NUMBER fields', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      ['def-1', def({ fieldType: CustomFieldType.NUMBER })],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: ['3', '9'] }],
      map,
      TENANT,
    );
    expect(captured[0].sql).toContain('AS NUMERIC');
    expect(captured[0].sql).toContain('>=');
    expect(captured[0].sql).toContain('<=');
    expect(Object.values(captured[0].params)).toContain(3);
    expect(Object.values(captured[0].params)).toContain(9);
  });

  it('builds a date range for DATE fields', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([['def-1', def({ fieldType: CustomFieldType.DATE })]]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: ['2026-01-01', '2026-02-01'] }],
      map,
      TENANT,
    );
    expect(captured[0].sql).toContain('AS DATE');
    expect(Object.values(captured[0].params)).toContain('2026-01-01');
    expect(Object.values(captured[0].params)).toContain('2026-02-01');
  });

  it('filters SYSTEM callId against chat.id, not the value table', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      [
        'sys',
        def({
          id: 'sys',
          fillMode: CustomFieldFillMode.SYSTEM,
          seedKey: 'callId',
        }),
      ],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'sys', value: '42' }],
      map,
      TENANT,
    );
    expect(captured[0].sql).toContain('chat.id');
    expect(captured[0].sql).not.toContain('chat_custom_field_values');
    expect(Object.values(captured[0].params)).toContain('%42%');
  });

  it('filters SYSTEM counsellorName via a users subquery', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      [
        'sys',
        def({
          id: 'sys',
          fillMode: CustomFieldFillMode.SYSTEM,
          seedKey: 'counsellorName',
        }),
      ],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'sys', value: 'Priya' }],
      map,
      TENANT,
    );
    expect(captured[0].sql).toContain('FROM users');
    expect(captured[0].sql).toContain('chat.counselorId');
    expect(Object.values(captured[0].params)).toContain('%Priya%');
  });

  it('maps SYSTEM mode to the callInfo->mode CASE expression', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      [
        'sys',
        def({
          id: 'sys',
          fillMode: CustomFieldFillMode.SYSTEM,
          seedKey: 'mode',
        }),
      ],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'sys', value: 'Dictation' }],
      map,
      TENANT,
    );
    expect(captured[0].sql).toContain("->>'mode'");
  });

  it('skips a NUMBER filter with non-numeric input (no invalid cast)', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      ['def-1', def({ fieldType: CustomFieldType.NUMBER })],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: 'abc' }],
      map,
      TENANT,
    );
    expect(captured).toHaveLength(0);
  });

  it('drops a non-numeric bound but keeps a valid one in a NUMBER range', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      ['def-1', def({ fieldType: CustomFieldType.NUMBER })],
    ]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: ['3', 'oops'] }],
      map,
      TENANT,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toContain('>=');
    expect(captured[0].sql).not.toContain('<=');
    expect(Object.values(captured[0].params)).toContain(3);
  });

  it('skips a DATE filter with an invalid date (no invalid cast)', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([['def-1', def({ fieldType: CustomFieldType.DATE })]]);
    applyFieldFilters(
      qb,
      [{ fieldDefinitionId: 'def-1', value: 'not-a-date' }],
      map,
      TENANT,
    );
    expect(captured).toHaveLength(0);
  });

  it('ANDs multiple filters with unique param names', () => {
    const { qb, captured } = makeQueryMock();
    const map = new Map([
      ['a', def({ id: 'a', fieldType: CustomFieldType.TEXT })],
      ['b', def({ id: 'b', fieldType: CustomFieldType.TEXT })],
    ]);
    applyFieldFilters(
      qb,
      [
        { fieldDefinitionId: 'a', value: 'one' },
        { fieldDefinitionId: 'b', value: 'two' },
      ],
      map,
      TENANT,
    );
    expect(captured).toHaveLength(2);
    const allKeys = captured.flatMap((c) => Object.keys(c.params));
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
