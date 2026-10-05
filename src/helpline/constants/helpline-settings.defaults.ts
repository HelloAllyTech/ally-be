import { HelplineSettings } from '../type/helpline.types';

/**
 * Org settings defaults (contract §8). Stored settings are a PARTIAL merged
 * over these on every read, so adding a setting needs no backfill.
 *
 * Emergency resources were verified on 2026-10-05: KIRAN (1800-599-0019) was
 * merged into Tele-MANAS and phased out, so it is deliberately absent.
 * Tele-MANAS is 14416 / 1-800-891-4416 (free, 24×7); 112 is the national
 * emergency number. Other languages fall back to English until an org edits
 * them — a wrong number in a translation is worse than English.
 */
export const HELPLINE_DEFAULT_SETTINGS: HelplineSettings = {
  retentionDays: 90,
  hours: null,
  languages: ['en', 'hi'],
  allowQueueWhenNoListeners: false,
  maxWaitMinutes: 30,
  idleEndMinutes: 15,
  maxWaitingTalkers: 50,
  orgMaxConcurrentPerListener: 3,
  emergencyResources: {
    en:
      'If you are in immediate danger, call 112. Tele-MANAS offers free, ' +
      '24×7 mental-health support: call 14416 or 1-800-891-4416.',
    hi:
      'अगर आप तुरंत खतरे में हैं, तो 112 पर कॉल करें। टेली-मानस मुफ़्त, ' +
      '24×7 मानसिक स्वास्थ्य सहायता देता है: 14416 या 1-800-891-4416 पर कॉल करें।',
  },
  closingMessage: {
    en:
      'Thank you for reaching out today. This chat has now ended. If you ' +
      'need to talk again, you can start a new chat whenever the helpline is open.',
    hi:
      'आज बात करने के लिए धन्यवाद। यह चैट अब समाप्त हो गई है। अगर आपको फिर ' +
      'से बात करनी हो, तो हेल्पलाइन खुली होने पर आप कभी भी नई चैट शुरू कर सकते हैं।',
  },
  escalationChecklist: [
    'Ask directly about thoughts of suicide or self-harm.',
    'Ask about a plan, means and timeframe.',
    'Share the emergency resources.',
    'Tell a supervisor now (use Alert supervisor).',
    "Stay with them — don't end the chat while they are at risk.",
    'Agree a next step and who they can be with.',
  ],
  // Push is off by default: v1 has no listener mobile surface, so there is no
  // device for a supervisor push to land on.
  supervisorAlertChannels: { inApp: true, push: false, slackWebhookUrl: null },
  listenerSupportContact: null,
  ageNotice: null,
  copilot: {
    suggestions: true,
    nudges: true,
    riskClassifier: true,
    rollingSummaryEveryTurns: 4,
  },
  riskHighConfidence: 0.7,
  summaryFields: [
    {
      key: 'presenting_concern',
      label: 'Presenting concern',
      description: 'What they came to talk about',
    },
    {
      key: 'feelings',
      label: 'Feelings',
      description: 'How they are feeling',
    },
    {
      key: 'risk',
      label: 'Risk',
      description: 'Any risk discussed, and what was agreed',
    },
    {
      key: 'supports',
      label: 'Supports',
      description: 'What they have tried and who supports them',
    },
    {
      key: 'next_step',
      label: 'Next step',
      description: 'Agreed next step',
    },
  ],
};
