import { Brackets, SelectQueryBuilder } from 'typeorm';
import { Chat } from '../entity/chat.entity';
import {
  CustomFieldDefinition,
  CustomFieldFillMode,
  CustomFieldType,
} from '../../custom-fields/entity/custom-field-definition.entity';
import { FieldFilter } from '../dto/call-log.request.dto';

/**
 * SQL expression (in terms of the `chat` / `details` query aliases) that
 * yields a text-comparable value for each SYSTEM-fillMode field's seedKey —
 * mirroring what system-field-computer.ts computes at read time. SYSTEM
 * fields are never persisted to chat_custom_field_values, so they're filtered
 * against their underlying columns instead of via an EXISTS subquery.
 *
 * `counsellorName` is handled separately (it needs a users-table subquery),
 * so it is intentionally absent here.
 */
const SYSTEM_FIELD_TEXT_EXPR: Record<string, string> = {
  callId: 'CAST(chat.id AS TEXT)',
  callDuration: 'CAST(details.callDuration AS TEXT)',
  callDate: 'CAST(chat.startedAt AS TEXT)',
  callTime: 'CAST(chat.startedAt AS TEXT)',
  clientId: 'CAST(chat.clientId AS TEXT)',
  listeningShare: `(details."callInfo"->>'clientTalkingPercentage')`,
  mode: `(CASE WHEN details."callInfo"->>'mode' = 'DICTATION' THEN 'Dictation' ELSE 'Scribe' END)`,
};

const asArray = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value];

const firstString = (value: string | string[]): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/** A parseable, finite number — guards NUMBER casts from NaN/garbage input. */
const isFiniteNumber = (v: string | undefined): boolean =>
  v != null && v.trim() !== '' && Number.isFinite(Number(v));

/** A parseable date string — guards DATE casts from invalid input (which
 * would otherwise raise a Postgres error and 500 the whole list). */
const isValidDate = (v: string | undefined): boolean =>
  v != null && v.trim() !== '' && !Number.isNaN(Date.parse(v));

/**
 * Applies custom/default-field filters to a call-logs query. Each filter is
 * ANDed with the rest. Definitions absent from `definitionMap`, inactive, or
 * with `filterable === false` are ignored (defence-in-depth; the client only
 * offers filterable fields). Empty values are skipped.
 *
 * Both `getCallLogsQuery` and `getAdminCallLogsQuery` expose the `chat` and
 * `details` aliases this relies on, so it works for both.
 */
export function applyFieldFilters(
  query: SelectQueryBuilder<Chat>,
  fieldFilters: FieldFilter[] | undefined,
  definitionMap: Map<string, CustomFieldDefinition>,
  tenantId: string,
): void {
  if (!fieldFilters?.length) return;

  fieldFilters.forEach((filter, idx) => {
    const def = definitionMap.get(filter.fieldDefinitionId);
    if (!def || def.isActive === false || def.filterable === false) return;

    const values = asArray(filter.value)
      .map((v) => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => v !== '' && v != null);
    if (values.length === 0) return;

    const p = (suffix: string) => `ff_${idx}_${suffix}`;

    if (def.fillMode === CustomFieldFillMode.SYSTEM) {
      applySystemFieldFilter(query, def, values, p);
      return;
    }

    applyPersistedFieldFilter(query, def, values, p, tenantId, idx);
  });
}

function applySystemFieldFilter(
  query: SelectQueryBuilder<Chat>,
  def: CustomFieldDefinition,
  values: string[],
  p: (suffix: string) => string,
): void {
  const seedKey = def.seedKey ?? '';

  // Counsellor name lives on the users table; match via a scoped subquery so
  // this works regardless of whether the outer query joined the counselor.
  if (seedKey === 'counsellorName') {
    query.andWhere(
      `EXISTS (SELECT 1 FROM users cu WHERE cu.id = chat.counselorId AND cu.name ILIKE :${p('v')})`,
      { [p('v')]: `%${firstString(values)}%` },
    );
    return;
  }

  const expr = SYSTEM_FIELD_TEXT_EXPR[seedKey];
  if (!expr) return;

  // All SYSTEM fields are TEXT-typed, so a case-insensitive substring match
  // against the computed text value is the consistent behaviour.
  query.andWhere(`${expr} ILIKE :${p('v')}`, {
    [p('v')]: `%${firstString(values)}%`,
  });
}

function applyPersistedFieldFilter(
  query: SelectQueryBuilder<Chat>,
  def: CustomFieldDefinition,
  values: string[],
  p: (suffix: string) => string,
  tenantId: string,
  idx: number,
): void {
  const cfv = `cfv_ff_${idx}`;

  // The value predicate on the joined cfv.value column, built per field type.
  // Returns null when the input yields no valid clause (e.g. a NUMBER field
  // with non-numeric input) so the whole filter is skipped rather than
  // producing an invalid cast.
  const buildValuePredicate = (): {
    sql: string;
    params: Record<string, unknown>;
  } | null => {
    switch (def.fieldType) {
      case CustomFieldType.TEXT:
      case CustomFieldType.MULTILINE_TEXT:
        return {
          sql: `${cfv}.value ILIKE :${p('v')}`,
          params: { [p('v')]: `%${firstString(values)}%` },
        };

      case CustomFieldType.SINGLE_SELECT:
      case CustomFieldType.BOOLEAN:
        return {
          sql: `${cfv}.value = ANY(:${p('v')})`,
          params: { [p('v')]: values },
        };

      case CustomFieldType.MULTI_SELECT:
        // Stored as a JSON array of option ids; match if it contains any of
        // the selected ids. `jsonb_exists_any` is the function form of the
        // `?|` operator (avoids `?` being treated as a param placeholder).
        return {
          sql: `jsonb_exists_any(${cfv}.value::jsonb, ARRAY[:...${p('v')}])`,
          params: { [p('v')]: values },
        };

      case CustomFieldType.NUMBER: {
        const [min, max] = [values[0], values[1]];
        const clauses: string[] = [];
        const params: Record<string, unknown> = {};
        if (isFiniteNumber(min)) {
          clauses.push(
            `CAST(NULLIF(${cfv}.value, '') AS NUMERIC) >= :${p('min')}`,
          );
          params[p('min')] = Number(min);
        }
        if (isFiniteNumber(max)) {
          clauses.push(
            `CAST(NULLIF(${cfv}.value, '') AS NUMERIC) <= :${p('max')}`,
          );
          params[p('max')] = Number(max);
        }
        // Single value (not a range) → exact match.
        if (clauses.length === 0) {
          const single = firstString(values);
          if (!isFiniteNumber(single)) return null;
          return {
            sql: `CAST(NULLIF(${cfv}.value, '') AS NUMERIC) = :${p('v')}`,
            params: { [p('v')]: Number(single) },
          };
        }
        return { sql: clauses.join(' AND '), params };
      }

      case CustomFieldType.DATE: {
        const [start, end] = [values[0], values[1]];
        const clauses: string[] = [];
        const params: Record<string, unknown> = {};
        if (isValidDate(start)) {
          clauses.push(
            `CAST(NULLIF(${cfv}.value, '') AS DATE) >= CAST(:${p('start')} AS DATE)`,
          );
          params[p('start')] = start;
        }
        if (isValidDate(end)) {
          clauses.push(
            `CAST(NULLIF(${cfv}.value, '') AS DATE) <= CAST(:${p('end')} AS DATE)`,
          );
          params[p('end')] = end;
        }
        if (clauses.length === 0) {
          const single = firstString(values);
          if (!isValidDate(single)) return null;
          return {
            sql: `CAST(NULLIF(${cfv}.value, '') AS DATE) = CAST(:${p('v')} AS DATE)`,
            params: { [p('v')]: single },
          };
        }
        return { sql: clauses.join(' AND '), params };
      }

      default:
        return {
          sql: `${cfv}.value ILIKE :${p('v')}`,
          params: { [p('v')]: `%${firstString(values)}%` },
        };
    }
  };

  const predicate = buildValuePredicate();
  if (!predicate) return;
  const { sql, params } = predicate;

  query.andWhere(
    new Brackets((qb) => {
      qb.where(
        `EXISTS (
           SELECT 1 FROM chat_custom_field_values ${cfv}
           WHERE ${cfv}."chatId" = chat.id
             AND ${cfv}.tenant_id = :${p('tenant')}
             AND ${cfv}."fieldDefinitionId" = :${p('def')}
             AND ${sql}
         )`,
        {
          [p('tenant')]: tenantId,
          [p('def')]: def.id,
          ...params,
        },
      );
    }),
  );
}
