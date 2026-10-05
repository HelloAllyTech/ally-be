import { Injectable, PipeTransform } from '@nestjs/common';
import { badRequest, chatNotFound } from './helpline-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A chat id path param. A malformed id answers the same 404 as an unknown
 * one — never a 400 that would distinguish the two, and never a Postgres
 * "invalid input syntax for type uuid" 500.
 */
@Injectable()
export class HelplineChatIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw chatNotFound();
    return value.toLowerCase();
  }
}

/** A user id path param (team routes). */
@Injectable()
export class HelplineUserIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0)
      throw badRequest('userId must be a positive integer');
    return id;
  }
}
