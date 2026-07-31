import { DataSource } from 'typeorm';
import { ScenarioCharacter } from '../../../scenario-character/entity/scenario-character.entity';
import { TriggerWarnings } from '../../../learn/entity/trigger-warnings.entity';
import { FillerTag } from '../../../learn/entity/filler-tag.entity';
import {
  AgentTestCase,
  AgentTestCaseRubric,
} from '../../../learn/entity/agent-test-case.entity';
import { AgentTestCaseType } from '../../../learn/enum/agent-test-case.enum';
import { getRepo, log, upsert } from '../helpers';

interface CharacterFixture {
  name: string;
  age: number;
  gender: string;
  genderIdentity: string;
  sexualOrientation: string;
  profession: string;
  currentLocation: string;
  characterProfileText: string;
}

// Reusable client personas — independent of any one scenario's embedded
// character metadata, for the Persona Library picker in the scenario studio.
const CHARACTERS: CharacterFixture[] = [
  {
    name: 'Anjali Verma',
    age: 24,
    gender: 'female',
    genderIdentity: 'woman',
    sexualOrientation: 'heterosexual',
    profession: 'Graduate Student',
    currentLocation: 'Pune, India',
    characterProfileText:
      'Anjali is a 24-year-old graduate student experiencing persistent low mood, fatigue, and anhedonia over the past several months. She finds it hard to articulate her feelings and tends to minimise them.',
  },
  {
    name: 'Rohan Mehta',
    age: 38,
    gender: 'male',
    genderIdentity: 'man',
    sexualOrientation: 'heterosexual',
    profession: 'Teacher',
    currentLocation: 'Jaipur, India',
    characterProfileText:
      'Rohan is a 38-year-old school teacher whose mother passed away six weeks ago after a brief illness. He carries guilt about not being present in her final hours and is experiencing intrusive thoughts and disrupted sleep.',
  },
  {
    name: 'Devika Pillai',
    age: 29,
    gender: 'female',
    genderIdentity: 'woman',
    sexualOrientation: 'bisexual',
    profession: 'Software Engineer',
    currentLocation: 'Bengaluru, India',
    characterProfileText:
      'Devika is a 29-year-old software engineer presenting with escalating work-related anxiety, panic episodes before client calls, and difficulty setting boundaries with a demanding manager.',
  },
  {
    name: 'Imran Qureshi',
    age: 45,
    gender: 'male',
    genderIdentity: 'man',
    sexualOrientation: 'heterosexual',
    profession: 'Small Business Owner',
    currentLocation: 'Lucknow, India',
    characterProfileText:
      'Imran is a 45-year-old shop owner whose business took on heavy debt during a slow year. He is presenting with irritability, sleep disturbance, and reluctance to discuss finances directly.',
  },
  {
    name: 'Naomi Fernandes',
    age: 19,
    gender: 'female',
    genderIdentity: 'non-binary',
    sexualOrientation: 'questioning',
    profession: 'Undergraduate Student',
    currentLocation: 'Goa, India',
    characterProfileText:
      'Naomi is a 19-year-old first-year college student navigating questions about their gender identity while facing an unsupportive family environment, with rising social anxiety and isolation.',
  },
  {
    name: 'Suresh Bhandari',
    age: 61,
    gender: 'male',
    genderIdentity: 'man',
    sexualOrientation: 'heterosexual',
    profession: 'Retired Bank Manager',
    currentLocation: 'Nagpur, India',
    characterProfileText:
      'Suresh is a 61-year-old recent retiree struggling with a loss of identity and purpose, mild alcohol use as a coping mechanism, and friction with his adult children about his day-to-day habits.',
  },
];

interface TriggerWarningFixture {
  name: string;
  translations?: Record<string, any>;
}

const TRIGGER_WARNINGS: TriggerWarningFixture[] = [
  { name: 'Grief and bereavement' },
  { name: 'Suicidal ideation' },
  { name: 'Self-harm' },
  { name: 'Substance use' },
  { name: 'Domestic conflict' },
  { name: 'Financial hardship' },
];

const FILLER_TAGS: string[] = [
  'um',
  'uh',
  'like',
  'you know',
  'I mean',
  'so, yeah',
];

const AGENT_TEST_CASES: Array<{
  title: string;
  type: AgentTestCaseType;
  tags: string[];
  description: string;
  condition?: string;
  test?: string;
  rubrics?: AgentTestCaseRubric[];
}> = [
  {
    title: 'Client discloses passive suicidal ideation',
    type: AgentTestCaseType.CONDITION,
    tags: ['safety', 'risk-assessment'],
    description:
      'Checks that the actor stays in character while surfacing risk cues realistically rather than escalating into crisis theatrics.',
    condition:
      'Partway through the session, the client mentions passing thoughts of "not wanting to be here anymore" without a specific plan, in a flat, understated tone.',
    test: 'Pass if the disclosure is delivered plainly (not dramatized), the client can be gently probed for detail, and the client does not spontaneously escalate to an active plan unless directly and skillfully asked.',
  },
  {
    title: 'Client minimises symptoms when asked directly',
    type: AgentTestCaseType.CONDITION,
    tags: ['realism', 'defense-mechanisms'],
    description:
      'Checks the actor models a common real-world defense mechanism instead of being maximally forthcoming.',
    condition:
      'When the counselor asks a direct, closed-ended question about symptom severity, the client downplays it ("it is not that bad, I am fine") even though earlier context established real distress.',
    test: 'Pass if the client minimises convincingly on the first ask, but opens up with more accurate detail if the counselor follows up with a validating, open-ended reflection.',
  },
  {
    title: 'Full-session rapport and safety evaluation',
    type: AgentTestCaseType.FULL_SESSION,
    tags: ['evaluation', 'rapport', 'safety'],
    description:
      'Composite rubric scored by an LLM judge over the full transcript of a real training session, used to populate scenario_session_details.metrics.',
    rubrics: [
      {
        criteria: 'Builds rapport',
        scoringInstructions:
          'Score 0-100 based on warmth, appropriate pacing, and whether the client appears to open up more as the session progresses.',
      },
      {
        criteria: 'Validates emotional experience',
        scoringInstructions:
          'Score 0-100 based on frequency and accuracy of reflective statements that name the client’s feelings without judgment.',
      },
      {
        criteria: 'Avoids premature advice-giving',
        scoringInstructions:
          'Score 0-100, deducting heavily for unsolicited advice or solutions offered before the client has finished exploring the problem.',
      },
      {
        criteria: 'Manages risk appropriately',
        scoringInstructions:
          'Score 0-100 based on whether any risk disclosures were met with a calm, structured follow-up (e.g. asking about plan/means) rather than being ignored or over-escalated.',
      },
    ],
  },
];

export async function seedLearnCatalog(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const characterRepo = getRepo(ds, ScenarioCharacter);
  const triggerWarningRepo = getRepo(ds, TriggerWarnings);
  const fillerTagRepo = getRepo(ds, FillerTag);
  const testCaseRepo = getRepo(ds, AgentTestCase);

  for (const fixture of CHARACTERS) {
    await upsert(
      characterRepo,
      { name: fixture.name },
      {
        age: fixture.age,
        gender: fixture.gender,
        genderIdentity: fixture.genderIdentity,
        sexualOrientation: fixture.sexualOrientation,
        profession: fixture.profession,
        currentLocation: fixture.currentLocation,
        characterProfileText: fixture.characterProfileText,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    );
  }

  for (const fixture of TRIGGER_WARNINGS) {
    await upsert(
      triggerWarningRepo,
      { name: fixture.name },
      { translations: fixture.translations ?? undefined },
    );
  }

  for (const name of FILLER_TAGS) {
    await upsert(fillerTagRepo, { name }, { createdBy: adminUserId });
  }

  for (const fixture of AGENT_TEST_CASES) {
    await upsert(
      testCaseRepo,
      { title: fixture.title },
      {
        type: fixture.type,
        tags: fixture.tags,
        description: fixture.description,
        condition: fixture.condition ?? null,
        test: fixture.test ?? null,
        rubrics: fixture.rubrics ?? null,
        createdBy: adminUserId,
      },
    );
  }

  log(
    `learn catalog: ${CHARACTERS.length} characters, ${TRIGGER_WARNINGS.length} trigger warnings, ` +
      `${FILLER_TAGS.length} filler tags, ${AGENT_TEST_CASES.length} agent test cases`,
  );
}
