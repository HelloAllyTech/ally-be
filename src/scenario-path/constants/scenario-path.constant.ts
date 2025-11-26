import { SessionItemStatus } from '../type/scenario-path-session-items.type';

export const SCENARIO_PATH_REQUIRED_FIELDS = [
  'title',
  'description',
  'coverImageUrl',
];

export const SCENARIO_PATH_MAX_SCENARIOS = 20;

export const SCENARIO_PATH_MIN_SCENARIOS = 2;

export const UPCOMING_SCENARIO_PATH_ITEM_EXAMPLE = {
  upcomingScenario: {
    id: 1,
    title: 'Customer Service Scenario',
    description: 'Practice handling customer complaints',
    coverImageUrl: 'https://example.com/scenario-cover.jpg',
    coverVideoUrl: 'https://example.com/scenario-cover.mp4',
    scenarioPathSessionItemStatus: SessionItemStatus.UNLOCKED,
    order: 2,
    scenarioPathSessionItemId: '550e8400-e29b-41d4-a716-446655440000',
  },
  currentSession: {
    scenarioId: 1,
    title: 'Introduction Scenario',
    description: 'Introduction to customer service',
    coverImageUrl: 'https://example.com/intro-scenario-cover.jpg',
    coverVideoUrl: 'https://example.com/intro-scenario-cover.mp4',
    scenarioPathSessionItemStatus: SessionItemStatus.COMPLETED,
    scenarioPathSessionItemId: '550e8400-e29b-41d4-a716-446655440001',
    transitionMessageTitle: 'Great job on the previous scenario!',
    transitionMessageContent:
      "You have successfully completed the first scenario. Now, let's move on to the next challenge.",
    scenarioPathSessionStatus: SessionItemStatus.COMPLETED,
  },
};
