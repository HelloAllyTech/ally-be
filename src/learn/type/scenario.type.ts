import { ScenarioStatus } from '../enum/scenario.status.enum';

export interface ScenarioData {
  status?: ScenarioStatus;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  lifeHistory?: string;
  voiceId?: string;
  age?: number;
  gender?: string;
  currentLocation?: string;
  autoTerminationStatus?: boolean;
  terminationMessage?: string;
  terminationEventId?: string;
  [key: string]: any;
}
