import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';
import { UserRole } from '../constants/user.constants';

const KNOWN_ROLES = new Set<string>(Object.values(UserRole));

/**
 * Validation for the `allowedRoles` list every client sends on an auth call.
 *
 * `allowedRoles` is a *filter*, not a claim: the server intersects it with the
 * groups the account actually holds (`allowedRoles.some(r => userGroups
 * .includes(r))` in AuthService) and admits the user only on a match. A role
 * name this build has never heard of therefore matches nothing and admits
 * nobody — it is inert, not dangerous. Rejecting the whole request over one is
 * strictly worse than ignoring it.
 *
 * Worse, because clients ship on their own schedule. Each surface hardcodes its
 * own list, so retiring a role turns every not-yet-redeployed client's login
 * into a 400 the moment the backend rolls out — for *all* of that surface's
 * users, not just holders of the retired role. That is what removing INTERNAL
 * did on 2026-08-06: ally-be deployed ahead of the consumer app, whose live
 * bundle still listed `INTERNAL`, and app.helloally.ai could not log anyone in.
 * A released mobile build cannot be redeployed at all, so there the same skew
 * would strand users until they update.
 *
 * So unknown names are dropped before validation and the recognised ones decide
 * the request. A list with no recognised role left is still a bad request —
 * ArrayNotEmpty fires — because that client can admit nobody and a 400 says so
 * more clearly than the 403 the empty intersection would produce.
 */
export function IsAllowedRoles(): PropertyDecorator {
  return applyDecorators(
    IsArray(),
    Transform(({ value }) =>
      Array.isArray(value)
        ? value.filter(
            (role) => typeof role === 'string' && KNOWN_ROLES.has(role),
          )
        : value,
    ),
    ArrayNotEmpty(),
    IsEnum(UserRole, { each: true }),
  );
}
