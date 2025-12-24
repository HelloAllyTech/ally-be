import { ScenarioStatus } from '../type/scenario.type';

export class ScenarioResponse {
  id!: number;
  title!: string;
  scenario!: string;
  description!: string;
  coverImageUrl!: string;
  status!: ScenarioStatus;
}
