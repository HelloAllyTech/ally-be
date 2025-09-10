import { ScenarioStatus } from '../enum/scenario.status.enum';

export class ScenarioResponse {
  id!: number;
  title!: string;
  scenario!: string;
  description!: string;
  coverImageUrl!: string;
  status!: ScenarioStatus;
}
