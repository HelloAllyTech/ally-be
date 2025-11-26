export const SCENARIO_PATH_REQUIRED_FIELDS = [
  'title',
  'description',
  'coverImageUrl',
];

export const SCENARIO_PATH_MAX_SCENARIOS = 20;

export const SCENARIO_PATH_MIN_SCENARIOS = 2;

export const UPCOMING_SCENARIO_PATH_ITEM_EXAMPLE = {
  id: 1,
  title: 'Customer Service Scenario',
  scenario: 'You are a customer service representative...',
  description: 'Practice handling customer complaints',
  coverImageUrl: 'https://example.com/scenario-cover.jpg',
  coverVideoUrl: 'https://example.com/scenario-cover.mp4',
  status: 'ACTIVE',
  prompt: 'You are a helpful customer service agent',
  metadata: {},
  createdBy: 123,
  updatedBy: 123,
  isGlobal: false,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T10:00:00Z',
  order: 2,
  scenarioPathSessionItemId: '123',
  transitionMessageTitle: 'Great job on the previous scenario!',
  transitionMessageContent:
    "You have successfully completed the first scenario. Now, let's move on to the next challenge.",
};
