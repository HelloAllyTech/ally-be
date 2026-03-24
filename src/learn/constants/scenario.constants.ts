import { DynamicBranchShortcut } from '../enum/dynamic-branch-shortcut.enum';

export const MAX_CUSTOM_FIELDS_COUNT = 3;
export const MAX_TERMINATION_EVENT_COUNT = 10;

export const BRANCHING_INSTRUCTION_DYNAMIC_SHORTCUTS: string[] = [
  DynamicBranchShortcut.CHAT_SUMMARY,
  DynamicBranchShortcut.LAST_HELPER_UTTERANCE,
  DynamicBranchShortcut.LLM_RESPONSE,
  DynamicBranchShortcut.YOUR_CONTEXT,
];

// Timer validation constants
export const LOWER_MAX_TIMER_VALUE = '00:05:00'; // 5 minutes
export const UPPER_MAX_TIMER_VALUE = '02:00:00'; // 2 hours

export const MAX_KNOWLEDGE_SOURCES_COUNT = 50;

export const SCENARIO_FIELDS = {
  TITLE: 'title',
  DESCRIPTION: 'description',
};
