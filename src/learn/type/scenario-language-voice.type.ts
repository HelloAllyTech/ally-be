import { LANGUAGE_STT_PROVIDER_CONFIG } from '../constants/scenario-session.constants';

export interface ScenarioVoice {
  id: string;
  name: string;
}

export interface ScenarioVoiceLanguage {
  language_id: number;
  value: string;
  label: string;
  voices: ScenarioVoice[];
}

export interface AvailableLanguage {
  language_id: number;
  value: string;
  label: string;
}

export type LanguageCode = keyof typeof LANGUAGE_STT_PROVIDER_CONFIG;
