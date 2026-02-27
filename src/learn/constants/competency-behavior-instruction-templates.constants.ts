import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { CompetencyBehaviorPresetMap } from '../type/generatable-fields.type';

export const COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS: CompetencyBehaviorPresetMap =
  {
    'Non-Verbal Communication': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Appears distracted (interrupting to pick up a call)',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Laughs at client',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'No acknowledgement after sharing',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Interrupts without permission',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Use of soft tone, voice pitch and pacing',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Uses supportive gestures',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Uses brief verbal encouragers (uh-huh, I see)',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Allows silences',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: "Adjusts voice, tone, emoting to match client's affect",
      },
    ],
    'Verbal Communication': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Interrupts client',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName:
          "Leading/suggestive closed questions (e.g. 'you did not want that right?')",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Overuse of "why" questions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Corrects or accuses client',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Uses culturally inappropriate or stigmatizing language',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Gives premature advice',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Uses open-ended questions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Allows client to complete statements',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Summarises and paraphrases',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Clarifies in first person',
      },
    ],
    'Explain & Promote Confidentiality': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Forces disclosure',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Describes confidentiality inaccurately',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Promises full confidentiality without exceptions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Minimises privacy concerns',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Clearly explains confidentiality',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Explains limits (harm to self/others/from others)',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Explains rationale for breaking confidentiality',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Describes referral/reporting process',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Addresses any questions/concerns about confidentiality',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Checks client understanding',
      },
    ],
    'Rapport Building & Self-Disclosure': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Dominates with personal stories',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: "Minimises client's problems",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Rushes clients',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Asks unnecessary embarrassing questions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Shares confidential information about others',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Over-shares personal experiences',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Introduces self and explains role',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Makes client comfortable (welcome, assuring)',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Assures client of their support',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: "Asks client's name and language preference",
      },
    ],
    'Exploration & Normalization of Feelings': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName:
          "Says client reaction is unusual (e.g., 'People don't usually react this way')",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Minimises/dismisses emotions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Forces emotional disclosure',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Judges emotional responses',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          'Asks client to reflect on the experience of sharing emotions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Normalises reactions appropriately',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Uses validating statements',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Explores hesitancy to share emotions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Reflects emotional expressions thoughtfully',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          "Comments thoughtfully on client's facial expression to encourage emotional expression",
      },
    ],
    'Empathy, Warmth & Genuineness': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: "Critical of client's concerns",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Dismissive of concerns',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Helper appears ingenuine, inappropriate or insincere',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Imposes personal beliefs',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Demonstrates warmth and genuineness',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Shows consistent concern and care',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          "Asks questions to identify what emotions the client was feeling (e.g., 'I wonder if you felt sad or angry when this happened')",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Is warm, friendly, and genuine throughout roleplay',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          "Asks client to reflect on empathic statements from helper (e.g., 'What did you think when I said you sounded sad?')",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: "Respects client's perspective",
      },
    ],
    'Assessment of Harm & Response Planning': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Does not ask about harm to self or others',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Lectures using moral/religious arguments',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Expresses shock or disbelief in response to disclosure',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Encourages secrecy about harm, promises not to share',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Leaves client alone after disclosure',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Asks directly about harm to self/others/from others',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Assesses intent, means, prior attempts',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Identifies risk and protective factors',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Develops collaborative safety plan',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Follows appropriate reporting or referral procedures',
      },
    ],
    'Linking Emotions, Thoughts & Behaviours': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Criticises client for reduced functioning',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Says no connection exists',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Induces guilt about family impact',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Focuses only on one domain (e.g., only behaviour)',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Dismisses emotions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          'Asks about daily functioning, behaviours and associated emotions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Explores link between symptoms and daily life',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          'Explores bidirectional relationship between thoughts, emotions, and behaviours',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          'Provides clear explanation of cognitive-behavioural model',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: "Uses examples relevant to client's life",
      },
    ],
    "Explore Client's Explanation for Problem": [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: "Criticises client's beliefs",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Endorses harmful beliefs',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: "Ignores client's explanatory model",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Directly challenges cultural beliefs',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: "Ignores client's understanding of problem",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Asks about perceived causes',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Explores family/social network views',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Incorporates client perspective into care',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Maintains curiosity towards client perspective',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Reframes harmful explanations respectfully',
      },
    ],
    'Involvement of Family & Significant Others': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Forces involvement',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Forbids involvement without reason',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Involves/insists on involving others without permission',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Allows family to disempower client',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: "Asks about close persons in client's life",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: "Explores client's preferences",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Involves others with consent',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName:
          'Facilitates supportive participation of family significant others',
      },
    ],
    'Collaborative Goal Setting': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Dictates goals',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Dismisses client goals without explanation',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Provides misleading information about outcomes',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Asks about client goals and expectations',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Explains achievable outcomes clearly',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Aligns treatment plan with client goals',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Reframes unrealistic goals collaboratively',
      },
    ],
    'Promote Realistic Hope': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Gives unrealistic promises',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Provides no hope for change',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Shames client doubts',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Expresses pessimism about change',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Praises help-seeking behaviour',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Encourages realistic optimism',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Explores and addresses doubts',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Clarifies limits of treatment realistically',
      },
    ],
    'Strengthen Coping Strategies': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Dismisses coping strategies',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Encourages harmful coping',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Judges past problem-solving attempts',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Asks about past/current coping',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Praises positive coping strategies',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Encourages continuation of safe coping',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Brainstorms alternatives collaboratively',
      },
    ],
    'Psychoeducation with Local Terminology': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Uses technical jargon without checking',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Uses stigmatizing language',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Does not check understanding',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Uses simple, clear language',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Integrates local terminology and idioms',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: "Incorporates client's explanatory model",
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Checks and clarifies understanding',
      },
    ],
    'Elicitation of Feedback': [
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Lectures without asking feedback',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Offers harmful suggestions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Ignores client feedback',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorName: 'Becomes defensive',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Asks for feedback on suggestions',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Clarifies and reframes based on feedback',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Summarises feedback and checks accuracy',
      },
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorName: 'Adjusts recommendations collaboratively',
      },
    ],
  };

export const getAllBehaviorNamesFromTemplates = (): string[] => {
  const names = new Set<string>();
  for (const templates of Object.values(
    COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS,
  )) {
    for (const template of templates) {
      names.add(template.behaviorName);
    }
  }
  return Array.from(names);
};
