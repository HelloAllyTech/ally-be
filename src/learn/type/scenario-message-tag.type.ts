import { ScenarioSessionTagCategory } from '../enum/scenario-session-tag-category.enum';

export interface MessageTagMapping {
  tagId: string;
  label: string;
  category: ScenarioSessionTagCategory;
}
