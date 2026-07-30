/** Socket.io message names for the `/product-roadmap` namespace. */
export enum RoadmapEvents {
  CONNECTED = 'CONNECTED',

  // client → server
  JOIN_BOARD = 'JOIN_BOARD',
  JOIN_OPPORTUNITY = 'JOIN_OPPORTUNITY',
  LEAVE_OPPORTUNITY = 'LEAVE_OPPORTUNITY',

  // server → client (tier 1: targeted deltas)
  ALLOCATION_CHANGED = 'ALLOCATION_CHANGED',
  OPPORTUNITY_UPSERTED = 'OPPORTUNITY_UPSERTED',
  OPPORTUNITY_DELETED = 'OPPORTUNITY_DELETED',
  COMMENT_CHANGED = 'COMMENT_CHANGED',

  // server → client (tier 2: one signal for sweeping structural changes)
  ROADMAP_INVALIDATED = 'ROADMAP_INVALIDATED',
}

export enum RoadmapRoomTypes {
  BOARD = 'BOARD',
  OPPORTUNITY = 'OPPORTUNITY',
}
