import { DynamicBranchShortcut } from '../enum/dynamic-branch-shortcut.enum';

export const MAX_CUSTOM_FIELDS_COUNT = 3;
export const MAX_TERMINATION_EVENT_COUNT = 10;
export const MAX_BEHAVIOR_INSTRUCTIONS_COUNT = 10;

export const BRANCHING_INSTRUCTION_DYNAMIC_SHORTCUTS: string[] = [
  DynamicBranchShortcut.CHAT_SUMMARY,
  DynamicBranchShortcut.LAST_HELPER_UTTERANCE,
  DynamicBranchShortcut.LLM_RESPONSE,
  DynamicBranchShortcut.YOUR_CONTEXT,
];
