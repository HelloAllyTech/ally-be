import { SessionItemStatus } from 'src/common/type/common.type';

export const CASE_REQUIRED_FIELDS = ['title', 'description', 'coverImageUrl'];

export const CASE_MAX_SCENARIOS = 20;

export const CASE_MIN_SCENARIOS = 2;

export const UPCOMING_CASE_ITEM_EXAMPLE = {
  upcomingScenario: {
    id: 1,
    title: 'Customer Service Scenario',
    description: 'Practice handling customer complaints',
    coverImageUrl: 'https://example.com/scenario-cover.jpg',
    coverVideoUrl: 'https://example.com/scenario-cover.mp4',
    caseSessionItemStatus: SessionItemStatus.UNLOCKED,
    order: 2,
    caseSessionItemId: '550e8400-e29b-41d4-a716-446655440000',
  },
  currentSession: {
    scenarioId: 1,
    title: 'Introduction Scenario',
    description: 'Introduction to customer service',
    coverImageUrl: 'https://example.com/intro-scenario-cover.jpg',
    coverVideoUrl: 'https://example.com/intro-scenario-cover.mp4',
    caseSessionItemStatus: SessionItemStatus.COMPLETED,
    caseSessionItemId: '550e8400-e29b-41d4-a716-446655440001',
    transitionMessageTitle: 'Great job on the previous scenario!',
    transitionMessageContent:
      "You have successfully completed the first scenario. Now, let's move on to the next challenge.",
    isCaseSessionCompleted: false,
  },
};
