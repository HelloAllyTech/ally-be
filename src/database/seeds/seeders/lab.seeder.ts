import { DataSource } from 'typeorm';
import { LabSkill } from '../../../lab/entity/lab-skill.entity';
import { LabVariable } from '../../../lab/entity/lab-variable.entity';
import { LabValue } from '../../../lab/entity/lab-value.entity';
import { getRepo, log, upsert } from '../helpers';

interface LabVariableFixture {
  name: string;
  description: string;
  values: Array<{ value: string; label: string }>;
}

const LAB_VARIABLES: LabVariableFixture[] = [
  {
    name: 'tone',
    description: 'The emotional tone the roleplay actor should adopt.',
    values: [
      { value: 'empathetic', label: 'Empathetic' },
      { value: 'firm', label: 'Firm but fair' },
      { value: 'anxious', label: 'Anxious client' },
    ],
  },
  {
    name: 'difficulty',
    description: 'Roleplay difficulty tier.',
    values: [
      { value: 'beginner', label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
    ],
  },
];

interface LabSkillFixture {
  name: string;
  description: string;
  content: string;
  temperature: number;
  maxTokens: number;
}

const LAB_SKILLS: LabSkillFixture[] = [
  {
    name: 'Empathetic Client Roleplay',
    description:
      'Base system prompt for a client who responds with empathy-seeking behavior.',
    content:
      'You are a client in a counseling roleplay. Adopt a {{tone}} tone and respond at {{difficulty}} difficulty. Stay in character and never break the fourth wall.',
    temperature: 0.7,
    maxTokens: 800,
  },
  {
    name: 'Scribe Note Summarizer',
    description:
      'Summarizes a session transcript into a structured clinical note.',
    content:
      'Summarize the following transcript into SOAP note format (Subjective, Objective, Assessment, Plan). Keep it under 300 words and avoid restating the transcript verbatim.',
    temperature: 0.3,
    maxTokens: 600,
  },
];

export async function seedLab(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const variableRepo = getRepo(ds, LabVariable);
  const valueRepo = getRepo(ds, LabValue);
  const skillRepo = getRepo(ds, LabSkill);

  let valueCount = 0;
  for (const fixture of LAB_VARIABLES) {
    const variable = await upsert(
      variableRepo,
      { name: fixture.name },
      { description: fixture.description, createdBy: adminUserId },
    );

    for (const value of fixture.values) {
      await upsert(
        valueRepo,
        { variableId: variable.id, value: value.value },
        { label: value.label, createdBy: adminUserId },
      );
      valueCount++;
    }
  }

  for (const fixture of LAB_SKILLS) {
    await upsert(
      skillRepo,
      { name: fixture.name },
      {
        description: fixture.description,
        content: fixture.content,
        temperature: fixture.temperature,
        maxTokens: fixture.maxTokens,
        createdBy: adminUserId,
      },
    );
  }

  log(
    `lab: ${LAB_VARIABLES.length} variables, ${valueCount} values, ${LAB_SKILLS.length} skills`,
  );
}
