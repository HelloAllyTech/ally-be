export type ConferenceCallSessionData = {
  id: string;
  chatId: number;
  clientId?: number;
  counselorId?: number;
  tenantId?: string;
  speakers?: {
    [key: string]: {
      id: number;
      role: string;
    };
  };
};

export enum ExotelStreamEvents {
  START = 'start',
  MEDIA = 'media',
  STOP = 'stop',
}
