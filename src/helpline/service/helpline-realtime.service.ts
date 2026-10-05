import { Injectable } from '@nestjs/common';
import { MessageBrokerChannel } from 'src/message-broker/constants/message-broker.constants';
import { MessageBrokerService } from 'src/message-broker/service/message-broker.service';
import { LoggerService } from 'src/logger/logger.service';
import { HelplineRooms } from '../constants/helpline.constants';
import { HelplineMessage } from '../entity/helpline-message.entity';
import {
  planMessageEmits,
  talkerRoomViolation,
} from '../util/helpline-serializers';

/**
 * What travels on the HELPLINE_SOCKET_EMIT broker channel. Every replica's
 * gateway applies it to its own LOCAL sockets (contract §6.2): the namespace
 * deliberately has no Redis adapter, so nothing here is delivered twice.
 */
export type HelplineBrokerEnvelope =
  | {
      op: 'emit';
      room: string;
      event: string;
      payload: unknown;
      /** A room whose members are skipped (socket.io `except`). */
      except?: string;
    }
  | { op: 'join'; target: string; room: string }
  | { op: 'leave'; target: string; room: string }
  | { op: 'disconnect'; room: string };

/**
 * The only way anything is emitted on `/helpline-chat`. Nothing calls
 * `server.emit` directly, so the talker-room guard below sits on every path.
 *
 * Delivery is best-effort by design: the database is the record, and a client
 * that missed an event closes the gap with SYNC_SINCE. A broker failure is
 * logged and swallowed — it must never fail the write that preceded it.
 */
@Injectable()
export class HelplineRealtimeService {
  private readonly logger = LoggerService.getInstance(
    HelplineRealtimeService.name,
  );

  constructor(private readonly broker: MessageBrokerService) {}

  async emit(
    room: string,
    event: string,
    payload: unknown,
    options: { except?: string } = {},
  ): Promise<void> {
    const violation = talkerRoomViolation(room, event, payload);
    if (violation) {
      // Never log the payload: it may be a staff DTO with a body in it.
      this.logger.error(`Refused emit to ${room}: ${violation}`);
      return;
    }
    await this.publish({ op: 'emit', room, event, payload, ...options });
  }

  /** Persisted message → staff DTO to the staff room, guest DTO to the talker room if visible. */
  async emitMessage(
    message: HelplineMessage,
    senderName: string | null,
  ): Promise<void> {
    for (const planned of planMessageEmits(message, senderName)) {
      await this.emit(planned.room, planned.event, planned.payload);
    }
  }

  /** Make every socket of `userId`, on every replica, join `room`. */
  async joinUser(userId: number, room: string): Promise<void> {
    await this.publish({
      op: 'join',
      target: HelplineRooms.user(userId),
      room,
    });
  }

  async leaveUser(userId: number, room: string): Promise<void> {
    await this.publish({
      op: 'leave',
      target: HelplineRooms.user(userId),
      room,
    });
  }

  /** Disconnect every socket in `room` everywhere (erasure, block). */
  async disconnectRoom(room: string): Promise<void> {
    await this.publish({ op: 'disconnect', room });
  }

  private async publish(envelope: HelplineBrokerEnvelope): Promise<void> {
    try {
      await this.broker.publish(
        MessageBrokerChannel.HELPLINE_SOCKET_EMIT,
        envelope,
      );
    } catch (error) {
      this.logger.error(
        `Helpline broker publish failed (${envelope.op}): ${(error as Error).message}`,
      );
    }
  }
}
