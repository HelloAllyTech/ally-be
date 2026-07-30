import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { RoadmapEvent } from '../type/roadmap-event.type';

type RoadmapEventListener = (event: RoadmapEvent) => void;

/**
 * Tiny listener registry that decouples the roadmap services from the websocket gateway, the
 * same shape as ScenarioReportNotificationService.
 *
 * WHY: services must never import the gateway. Doing so creates a circular dependency (the
 * gateway needs the services to build its join-time snapshot) and makes every service
 * untestable without a socket server. Here a service depends only on this, and the gateway
 * registers itself in afterInit().
 *
 * Fan-out is IN-PROCESS. There is no socket.io Redis adapter in ally-be, so a mutation served
 * by one instance will not reach clients connected to another. Supabase Realtime — which this
 * replaces — did fan out globally, so this is a genuine regression once ally-be runs more than
 * one replica, and it manifests as "sometimes the board doesn't update", which is miserable to
 * debug. It is a pre-existing platform property (ScenarioReportGateway has it too), so it is
 * not fixed here, but it is written down. The fix when needed is @socket.io/redis-adapter wired
 * in main.ts; Redis is already a dependency.
 */
@Injectable()
export class RoadmapNotificationService implements OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    RoadmapNotificationService.name,
  );

  private listener?: RoadmapEventListener;

  addListener(listener: RoadmapEventListener): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = undefined;
  }

  /**
   * Fire and forget. A broadcast failure must never fail the mutation that caused it — the
   * write is already committed and the client will reconcile on its next fetch.
   */
  emit(event: RoadmapEvent): void {
    if (!this.listener) return;
    try {
      this.listener(event);
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Failed to broadcast ${event.kind}: ${(error as Error)?.message}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.removeListener();
  }
}
