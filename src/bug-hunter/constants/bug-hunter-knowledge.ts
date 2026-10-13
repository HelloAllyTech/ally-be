import { BugHunterFeatureMap } from '../entity/bug-hunter-feature-map.entity';
import {
  BugPrecedent,
  renderPrecedents,
} from '../service/bug-hunter-precedent.service';
import { renderFeatureCards } from './bug-feature-map-prompt';
import { BugHunterPlaybook, renderPlaybooks } from './bug-hunter-playbooks';

/**
 * What Bug Hunter knows that fits one bug before anyone reads its code: the
 * playbooks for its class, resolved bugs that read like it, and the feature
 * cards for the feature it is in. Assembled by BugHunterKnowledgeService and
 * rendered the same way in the fix dossier and the Verifier's brief.
 */
export interface BugKnowledge {
  playbooks: BugHunterPlaybook[];
  precedents: BugPrecedent[];
  featureCards: BugHunterFeatureMap[];
}

export const EMPTY_KNOWLEDGE: BugKnowledge = {
  playbooks: [],
  precedents: [],
  featureCards: [],
};

export const renderKnowledge = (
  k: BugKnowledge | null | undefined,
): string[] =>
  k
    ? [
        ...renderFeatureCards(k.featureCards),
        ...renderPrecedents(k.precedents),
        ...renderPlaybooks(k.playbooks),
      ]
    : [];
