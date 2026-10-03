/**
 * The foundational helping skills rubric, as a transcript judge can apply it:
 * the 14 skills that leave evidence in a speech-to-text transcript, each with
 * its behaviours split three ways — unhelpful or potentially harmful, basic,
 * advanced — and the rule for when the skill is assessable at all.
 *
 * The full reference, with what each skill looks like in practice, lives in
 * `docs/foundational-helping-skills.md`. This file is deliberately independent
 * of every scenario's own competencies and behaviour instructions: it is the one
 * fixed ruler the platform measures every learner against, whatever they happen
 * to be practising.
 *
 * ## What was left out, and why
 *
 * - **Non-verbal communication**, entirely. Every behaviour in it (eye contact,
 *   posture, nodding, facial expression, physical contact) is visual, and the
 *   voice analogues (tone, pitch, pacing) do not survive into a transcript.
 * - Individual behaviours that need timing or sight rather than words:
 *   "interrupts client", "allows client to complete statements" and "matches
 *   rhythm" under verbal communication, "comments on facial expression" under
 *   feelings. They are listed in `excludedFromText` so the omission is visible,
 *   not silent.
 *
 * ## Changing anything in this file
 *
 * Any edit to a behaviour, an opportunity rule or the judge prompt changes the
 * ruler. Bump `FHS_RUBRIC_VERSION` in the same change: assessments are keyed by
 * version, the chart reads only the current one, and the scheduler re-scores
 * every cut under the new version. Scores from two versions are never averaged
 * together. Skill keys and behaviour codes are stored, so never rename one —
 * retire it and add a new one.
 */

/** Keys every stored assessment. Bump on ANY change to rubric, prompt or model. */
export const FHS_RUBRIC_VERSION = 'fhs-text-v1';

/**
 * Pinned rather than tier-resolved: a trend line is only honest if the same
 * model scored every point on it. A tier env change would otherwise move the
 * whole curve without any learner practising differently, which is exactly the
 * caveat the Skill growth chart has to print about itself. Changing this is a
 * rubric version bump.
 */
export const FHS_JUDGE_MODEL = 'gpt-5-mini';

/** A cut closes once the learner has said this many characters (code points). */
export const FHS_CUT_LEARNER_CHARS = 5000;

/**
 * How much of the same session, before a cut that starts mid-session, the judge
 * sees as unscored context. Enough for the client's presenting problem, which is
 * what most opportunity rules hinge on.
 */
export const FHS_CONTEXT_CHARS = 2000;

/**
 * A session joins the corpus only this long after it ended. The last turns land
 * over SQS seconds after the end signal and message timestamps are rewritten at
 * finalisation, so reading earlier could cut a session one way today and
 * another way tomorrow — and cuts are append-only.
 */
export const FHS_SESSION_SETTLE_MINUTES = 60;

/**
 * A cut or benchmark session whose scoring fails this many times stays FAILED
 * until someone looks. Failed attempts retry no more than hourly.
 */
export const FHS_MAX_ATTEMPTS = 3;

/** Judge calls in flight at once, per pipeline, within one scheduler tick. */
export const FHS_SCORE_CONCURRENCY = 4;

export type FhsTier = 'engage' | 'understand' | 'support';

export interface FhsBehaviour {
  /** Stable code, `<skill>.<u|b|a><n>` (unhelpful / basic / advanced). */
  code: string;
  text: string;
  /**
   * An unhelpful behaviour defined by something the helper did NOT do ("does
   * not ask about self-harm"). The judge may only mark it when the opportunity
   * clearly arose and the helper had room to act on it; its quote is the
   * client line that created the opportunity.
   */
  absence?: true;
  /**
   * A basic behaviour that depends on something only the client can supply
   * (feedback to adapt to, a positive coping strategy to praise). When the
   * client never supplied it, the judge marks it not applicable and it drops
   * out of the "all basic behaviours" requirement instead of capping the skill
   * at score 2 for a reason the helper could not control.
   */
  conditional?: true;
}

export interface FhsSkill {
  /** Stable key, stored in assessments and served by the API. */
  key: string;
  name: string;
  tier: FhsTier;
  /** When the skill is assessable at all. No opportunity means no score. */
  opportunity: string;
  unhelpful: FhsBehaviour[];
  basic: FhsBehaviour[];
  advanced: FhsBehaviour[];
  /** Behaviours of the skill that a transcript cannot show. */
  excludedFromText?: string[];
}

export const FHS_RUBRIC: readonly FhsSkill[] = [
  {
    key: 'verbal',
    name: 'Verbal communication',
    tier: 'engage',
    opportunity: 'Always assessable when the helper speaks in the window.',
    unhelpful: [
      {
        code: 'verbal.u1',
        text: 'Asks many suggestive or leading closed-ended questions (e.g. "You didn\'t really want to do that, right?")',
      },
      {
        code: 'verbal.u2',
        text: 'Corrects the client ("What you really mean is…") or makes accusatory statements ("You shouldn\'t have said that")',
      },
      {
        code: 'verbal.u3',
        text: 'Uses culturally or age-inappropriate language or terms',
      },
    ],
    basic: [
      { code: 'verbal.b1', text: 'Uses open-ended questions' },
      {
        code: 'verbal.b2',
        text: 'Summarises or paraphrases what the client said',
      },
    ],
    advanced: [
      {
        code: 'verbal.a1',
        text: 'Encourages the client to continue explaining (e.g. "Tell me more about…")',
      },
      {
        code: 'verbal.a2',
        text: 'Clarifies in the first person (e.g. "I heard you say…", "What I understood is…")',
      },
    ],
    excludedFromText: [
      'Interrupts client',
      'Allows client to complete statements before responding',
      "Matches rhythm to client's, allowing longer or shorter pauses",
    ],
  },
  {
    key: 'confidentiality',
    name: 'Explain and promote confidentiality',
    tier: 'engage',
    opportunity:
      'The client raises a concern about privacy or who will be told, or the helper brings up confidentiality.',
    unhelpful: [
      {
        code: 'confidentiality.u1',
        text: 'Forces the client to disclose to the helper or others',
      },
      {
        code: 'confidentiality.u2',
        text: 'Describes confidentiality inaccurately (e.g. "I will only tell your family")',
      },
      {
        code: 'confidentiality.u3',
        text: 'Promises full confidentiality without any exceptions',
      },
      {
        code: 'confidentiality.u4',
        text: 'Minimises the client\'s concerns about confidentiality (e.g. "It doesn\'t matter if anyone hears us")',
      },
    ],
    basic: [
      {
        code: 'confidentiality.b1',
        text: 'Explains the concept of confidentiality',
      },
      {
        code: 'confidentiality.b2',
        text: 'Lists exceptions to confidentiality for self-harm or harm to others',
      },
      {
        code: 'confidentiality.b3',
        text: 'Explains why it can be important to break confidentiality',
      },
    ],
    advanced: [
      {
        code: 'confidentiality.a1',
        text: 'Details the referral process or chain of communication for the exceptions (e.g. supervisor, then others who can help)',
      },
      {
        code: 'confidentiality.a2',
        text: "Asks questions to check the client's understanding of confidentiality",
      },
      {
        code: 'confidentiality.a3',
        text: 'Keeps topics appropriate to how private the setting is (e.g. checks whether others can overhear before sensitive topics)',
      },
    ],
  },
  {
    key: 'rapport',
    name: 'Rapport-building and self-disclosure',
    tier: 'engage',
    opportunity:
      'The window contains the opening of a session (its first exchanges).',
    unhelpful: [
      {
        code: 'rapport.u1',
        text: 'Dominates the conversation describing a personal experience',
      },
      {
        code: 'rapport.u2',
        text: "Minimises the client's problem by describing how the helper dealt with the same thing",
      },
      {
        code: 'rapport.u3',
        text: 'Asks unnecessary, embarrassing personal questions',
      },
      {
        code: 'rapport.u4',
        text: "Discusses other clients' confidential information",
      },
    ],
    basic: [
      { code: 'rapport.b1', text: 'Introduces self and explains their role' },
      { code: 'rapport.b2', text: 'Makes casual, informal conversation' },
      {
        code: 'rapport.b3',
        text: "Asks for the client's introduction (e.g. name, what they prefer to be called)",
      },
      {
        code: 'rapport.b4',
        text: 'Shares general experience related to the client (e.g. about their community or region), not personal problems',
      },
    ],
    advanced: [
      {
        code: 'rapport.a1',
        text: 'Asks the client to reflect on information the helper has shared',
      },
      {
        code: 'rapport.a2',
        text: "Checks in on the client's comfort (e.g. preferred language, whether now is a good time)",
      },
    ],
  },
  {
    key: 'feelings',
    name: 'Exploration and normalisation of feelings',
    tier: 'engage',
    opportunity:
      'The client describes a difficulty, a distressing situation or an emotional reaction.',
    unhelpful: [
      {
        code: 'feelings.u1',
        text: 'Says the client\'s reaction is unusual or atypical (e.g. "People don\'t usually react this way")',
      },
      {
        code: 'feelings.u2',
        text: "Minimises or dismisses the client's feelings",
      },
      { code: 'feelings.u3', text: 'Forces the client to describe emotions' },
    ],
    basic: [
      {
        code: 'feelings.b1',
        text: 'Appropriately encourages the client to share feelings',
      },
      {
        code: 'feelings.b2',
        text: 'Explains that others may have similar reactions, symptoms or concerns after similar experiences (normalising)',
      },
      {
        code: 'feelings.b3',
        text: 'Asks the client to reflect on the experience of sharing emotions',
      },
    ],
    advanced: [
      {
        code: 'feelings.a1',
        text: 'Explores possible reasons for hesitance to share emotions',
      },
      {
        code: 'feelings.a2',
        text: 'Validates emotional responses while reframing potentially harmful emotional reactions',
      },
    ],
    excludedFromText: [
      "Comments thoughtfully on client's facial expression to encourage emotional expression",
    ],
  },
  {
    key: 'empathy',
    name: 'Empathy, warmth and genuineness',
    tier: 'engage',
    opportunity: 'The client shares a concern, a problem or an emotion.',
    unhelpful: [
      { code: 'empathy.u1', text: "Is critical of the client's concerns" },
      { code: 'empathy.u2', text: "Is dismissive of the client's concerns" },
      {
        code: 'empathy.u3',
        text: "The helper's emotional response reads as inappropriate, fake or acted (e.g. formulaic sympathy that ignores what was said)",
      },
    ],
    basic: [
      {
        code: 'empathy.b1',
        text: 'Is warm, friendly and genuine throughout the window',
      },
      {
        code: 'empathy.b2',
        text: 'Continuously shows concern or care (e.g. "That sounds sad. Can you tell me more about it?")',
      },
      {
        code: 'empathy.b3',
        text: 'Asks questions to identify the emotions the client felt (e.g. "I wonder if you felt sad or angry when this happened")',
      },
    ],
    advanced: [
      {
        code: 'empathy.a1',
        text: 'Asks the client to reflect on the helper\'s empathic statements (e.g. "What did you think when I said you sounded sad?")',
      },
    ],
  },
  {
    key: 'harm',
    name: 'Assessment of harm and developing a response plan',
    tier: 'engage',
    opportunity:
      'The client gives a cue of hopelessness, wishing not to be alive, self-harm, suicide, or harm to or from others — or the helper raises the topic.',
    unhelpful: [
      {
        code: 'harm.u1',
        text: 'Does not ask about self-harm after the client gave such a cue',
        absence: true,
      },
      {
        code: 'harm.u2',
        text: 'Lectures the client with religious or legal reasons against self-harm (e.g. "This is a sin", "This is against the law")',
      },
      {
        code: 'harm.u3',
        text: 'Expresses disbelief (e.g. suggests the client says it for attention, or that others would not really cause harm)',
      },
      {
        code: 'harm.u4',
        text: 'Encourages the client not to tell anyone else about self-harm or harm to others',
      },
    ],
    basic: [
      {
        code: 'harm.b1',
        text: 'Asks about self-harm or harm to others, or explores it when the client raises it',
      },
      {
        code: 'harm.b2',
        text: 'Asks about current intent, plans or means, or prior attempts',
      },
    ],
    advanced: [
      {
        code: 'harm.a1',
        text: 'Explores risk and protective factors (e.g. reasons for living, who supports them)',
      },
      {
        code: 'harm.a2',
        text: 'Agrees a safety or response plan (e.g. involving a supervisor or trusted person, removing means, following up)',
      },
    ],
  },
  {
    key: 'functioning',
    name: 'Connect to social functioning and impact on life',
    tier: 'understand',
    opportunity:
      'The client describes a personal problem or distress of their own (not, say, a complaint about a service).',
    unhelpful: [
      {
        code: 'functioning.u1',
        text: 'Criticises the client for letting symptoms affect functioning (e.g. "You are weak", "You have no willpower")',
      },
      {
        code: 'functioning.u2',
        text: 'Says there is no connection between the problem and daily functioning, or never asks how the problem affects daily life',
        absence: true,
      },
      {
        code: 'functioning.u3',
        text: 'Criticises the client for the impact of their problems on children, partner or family',
      },
      {
        code: 'functioning.u4',
        text: 'Makes the client feel guilty for the impact on children, family or others',
      },
    ],
    basic: [
      {
        code: 'functioning.b1',
        text: 'Asks about daily functioning (work, sleep, self-care, relationships, routines)',
      },
      {
        code: 'functioning.b2',
        text: 'Discusses the connection between daily functioning and how the client is feeling',
      },
    ],
    advanced: [
      {
        code: 'functioning.a1',
        text: "Clarifies or supports the client's own connections between functioning and wellbeing, or reframes them",
      },
      {
        code: 'functioning.a2',
        text: 'Explores the connection in both directions (daily life affecting feelings, and feelings affecting daily life)',
      },
      {
        code: 'functioning.a3',
        text: 'Asks about the history of functioning (e.g. "How long has this been going on?", what it was like before)',
      },
    ],
  },
  {
    key: 'explanation',
    name: "Explore the client's explanation for the problem",
    tier: 'understand',
    opportunity: "The client's problem is being discussed.",
    unhelpful: [
      {
        code: 'explanation.u1',
        text: "Criticises the client's view of the problem as ignorant, superstitious or wrong",
      },
      {
        code: 'explanation.u2',
        text: 'Endorses harmful beliefs held by the client or their social network',
      },
    ],
    basic: [
      {
        code: 'explanation.b1',
        text: "Asks about the client's own view of what causes the problem",
      },
      {
        code: 'explanation.b2',
        text: 'Asks what family or the social support network think causes the problem',
      },
    ],
    advanced: [
      {
        code: 'explanation.a1',
        text: "Incorporates the client's view of the cause into planning, in a non-harmful way",
      },
      {
        code: 'explanation.a2',
        text: 'Discusses alternatives to a harmful explanation (e.g. "I wonder if there is another way to think about this?")',
      },
      {
        code: 'explanation.a3',
        text: "Addresses differences between the client's view of the cause and others' views",
      },
    ],
  },
  {
    key: 'family',
    name: 'Involvement of family and significant others',
    tier: 'understand',
    opportunity:
      'Family or other close people come up, or sources of support are being discussed.',
    unhelpful: [
      {
        code: 'family.u1',
        text: 'Tells the client not to involve family or close people in any way',
      },
      {
        code: 'family.u2',
        text: 'Forces the client to involve family or close people',
      },
      {
        code: 'family.u3',
        text: "Says they will speak with family or close people without the client's permission",
      },
      {
        code: 'family.u4',
        text: 'Lets an accompanying family member or close person disempower the client (speak for them, stay without agreement)',
      },
    ],
    basic: [
      {
        code: 'family.b1',
        text: "Asks about close people in the client's life (household, family or others)",
      },
      {
        code: 'family.b2',
        text: 'Asks how the client would like to involve close people in their care or support',
      },
      { code: 'family.b3', text: 'Asks who the client lives with' },
    ],
    advanced: [
      {
        code: 'family.a1',
        text: "Explores the client's reasons for involving or not involving a close person",
      },
      {
        code: 'family.a2',
        text: 'Role-plays or rehearses the conversation with the close person (e.g. helper plays the family member)',
      },
    ],
  },
  {
    key: 'goals',
    name: 'Collaborative goal-setting',
    tier: 'support',
    opportunity:
      'The client states a goal or an expectation of the help, or the conversation turns to what the client wants or next steps.',
    unhelpful: [
      {
        code: 'goals.u1',
        text: 'Tells the client their goals or expectations cannot be met but gives no reason',
      },
      {
        code: 'goals.u2',
        text: 'Gives incorrect, misleading or unrealistic information about goals or what the help can achieve',
      },
      {
        code: 'goals.u3',
        text: 'Dictates a goal for the client (forces it on them)',
      },
    ],
    basic: [
      {
        code: 'goals.b1',
        text: "Asks about the client's goals or expectations",
      },
      {
        code: 'goals.b2',
        text: "Explains how the client's goals and expectations fit with what they will work on together",
      },
    ],
    advanced: [
      {
        code: 'goals.a1',
        text: "Prioritises or modifies the plan to fit the client's goals",
      },
      {
        code: 'goals.a2',
        text: 'Works with the client to reframe a goal within scope (e.g. "Your goal is to get a job. Could we work on a goal that helps you get there?")',
      },
    ],
  },
  {
    key: 'hope',
    name: 'Promote realistic hope for change',
    tier: 'support',
    opportunity:
      'The client expresses doubt or hopelessness, asks whether things will get better or whether the help will work, or the outlook is being discussed.',
    unhelpful: [
      {
        code: 'hope.u1',
        text: 'Makes negative statements about the client\'s doubts (e.g. "How do you expect to get better if you have no hope?")',
      },
      {
        code: 'hope.u2',
        text: 'Gives unrealistic expectations (e.g. "Everything will be cured or solved")',
      },
      {
        code: 'hope.u3',
        text: 'Provides no hope for change (e.g. "This problem cannot be solved")',
      },
    ],
    basic: [
      {
        code: 'hope.b1',
        text: 'Explains how the client can be hopeful about the possibility of change',
      },
      {
        code: 'hope.b2',
        text: 'Praises the client for seeking help or care',
      },
    ],
    advanced: [
      {
        code: 'hope.a1',
        text: "Asks about and explores the client's doubts about the help",
      },
      {
        code: 'hope.a2',
        text: "Shares reasons for hope based on the helper's experience or the client's own behaviour",
      },
      {
        code: 'hope.a3',
        text: 'Discusses reasons for hope when the client is doubtful or dissatisfied',
      },
    ],
  },
  {
    key: 'coping',
    name: 'Incorporate coping mechanisms and prior solutions',
    tier: 'understand',
    opportunity: "The client's problem is being discussed.",
    unhelpful: [
      {
        code: 'coping.u1',
        text: 'Makes negative statements about the client\'s coping (e.g. "That would never work")',
      },
      { code: 'coping.u2', text: 'Encourages harmful coping' },
    ],
    basic: [
      {
        code: 'coping.b1',
        text: 'Asks about current or past coping (how they have kept going, what they have tried)',
      },
      {
        code: 'coping.b2',
        text: 'Praises positive or safe current or past solutions',
        conditional: true,
      },
    ],
    advanced: [
      {
        code: 'coping.a1',
        text: 'Encourages continued use of positive coping',
      },
      {
        code: 'coping.a2',
        text: 'Reflects on unhealthy strategies and brainstorms positive alternatives with the client',
      },
    ],
  },
  {
    key: 'psychoeducation',
    name: 'Psychoeducation with local terminology',
    tier: 'understand',
    opportunity:
      'The helper explains a symptom, a stress reaction, a condition or a treatment, or the client asks what is happening to them.',
    unhelpful: [
      {
        code: 'psychoeducation.u1',
        text: "Uses technical terms without checking the client's understanding",
      },
      {
        code: 'psychoeducation.u2',
        text: 'Uses stigmatising mental-health terms',
      },
    ],
    basic: [
      {
        code: 'psychoeducation.b1',
        text: 'Gives accurate psychoeducation in simple terms',
      },
      {
        code: 'psychoeducation.b2',
        text: 'Includes local concepts or everyday terminology in the explanation',
      },
    ],
    advanced: [
      {
        code: 'psychoeducation.a1',
        text: "Incorporates the client's own description of the problem (their words or metaphor)",
      },
      {
        code: 'psychoeducation.a2',
        text: 'Checks that the client understood the explanation',
      },
    ],
  },
  {
    key: 'feedback',
    name: 'Elicitation of feedback',
    tier: 'support',
    opportunity:
      'The helper offers a suggestion, advice, a plan or an explanation.',
    unhelpful: [
      {
        code: 'feedback.u1',
        text: 'Lectures the client about what to do without asking for their feedback',
      },
      { code: 'feedback.u2', text: 'Offers negative or harmful suggestions' },
    ],
    basic: [
      {
        code: 'feedback.b1',
        text: 'Asks for feedback to see whether the suggestions are helpful (e.g. "How does that sound?")',
      },
      {
        code: 'feedback.b2',
        text: 'Provides clarifications, reframing or alternative suggestions based on the feedback',
        conditional: true,
      },
    ],
    advanced: [
      {
        code: 'feedback.a1',
        text: "Summarises the client's feedback and checks the interpretation is correct",
      },
    ],
  },
];

export type FhsBehaviourKind = 'unhelpful' | 'basic' | 'advanced';

export interface IndexedFhsBehaviour extends FhsBehaviour {
  skill: string;
  kind: FhsBehaviourKind;
}

/** Every behaviour by code, for validating what the judge returns. */
export const FHS_BEHAVIOURS_BY_CODE: ReadonlyMap<string, IndexedFhsBehaviour> =
  new Map(
    FHS_RUBRIC.flatMap((skill) =>
      (['unhelpful', 'basic', 'advanced'] as const).flatMap((kind) =>
        skill[kind].map(
          (b) => [b.code, { ...b, skill: skill.key, kind }] as const,
        ),
      ),
    ),
  );

export const FHS_SKILL_KEYS: readonly string[] = FHS_RUBRIC.map((s) => s.key);
