import { QueryRunner } from 'typeorm';

import {
  ROADMAP_CATEGORIES,
  ROADMAP_DESCRIPTION_MAX_LENGTH,
  ROADMAP_NOTE_MAX_LENGTH,
  ROADMAP_STAGES,
  ROADMAP_TITLE_MAX_LENGTH,
} from '../../public-roadmap/constants/public-roadmap.constants';

import { ReplacePublicRoadmapCards1977200000000 } from './1977200000000-ReplacePublicRoadmapCards';

type Inserted = {
  category: string;
  stage: string;
  title: string;
  description: string;
  note: string | null;
  sortOrder: number;
};

const run = async (direction: 'up' | 'down') => {
  const queries: string[] = [];
  const inserted: Inserted[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.startsWith('INSERT')) {
        const [category, stage, title, description, note, sortOrder] =
          params as [string, string, string, string, string | null, number];
        inserted.push({ category, stage, title, description, note, sortOrder });
      }
      return [];
    }),
  } as unknown as QueryRunner;
  await new ReplacePublicRoadmapCards1977200000000()[direction](queryRunner);
  return { queries, inserted };
};

describe('ReplacePublicRoadmapCards', () => {
  it('deletes every existing card before inserting, hidden ones included', async () => {
    const { queries } = await run('up');

    expect(queries[0]).toBe(`DELETE FROM "public_roadmap_items"`);
    expect(queries.slice(1).every((sql) => sql.startsWith('INSERT'))).toBe(
      true,
    );
  });

  it('places the ten cards in their cells, top to bottom', async () => {
    const { inserted } = await run('up');

    expect(
      inserted.map(
        ({ category, stage, title, sortOrder }) =>
          `${category}/${stage}/${sortOrder} ${title}`,
      ),
    ).toEqual([
      'prepare/lab/0 Authoring Studio',
      'prepare/lab/1 Authoring Co-pilot',
      'prepare/beta/0 Debrief Supervisor',
      'prepare/beta/1 Competency Measurement',
      'prepare/released/0 Courses',
      'prepare/stable/0 Voice Roleplays',
      'perform/idea/0 Care Worker Co-pilot',
      'perform/lab/0 Text Chat Helpline',
      'perform/lab/1 WhatsApp Q&A',
      'perform/beta/0 Helpline Note Taker',
    ]);
    expect(
      inserted
        .filter(({ note }) => note)
        .map(({ title, note }) => [title, note]),
    ).toEqual([
      ['Authoring Studio', 'Current priority'],
      ['Text Chat Helpline', 'Pilot in 3 months'],
    ]);
  });

  it.each(['up', 'down'] as const)(
    '%s writes only cards the table and the admin form would accept',
    async (direction) => {
      const { inserted } = await run(direction);

      expect(inserted).toHaveLength(10);
      for (const card of inserted) {
        expect(ROADMAP_CATEGORIES).toContain(card.category);
        expect(ROADMAP_STAGES).toContain(card.stage);
        expect(card.title.length).toBeLessThanOrEqual(ROADMAP_TITLE_MAX_LENGTH);
        expect(card.description.length).toBeLessThanOrEqual(
          ROADMAP_DESCRIPTION_MAX_LENGTH,
        );
        expect((card.note ?? '').length).toBeLessThanOrEqual(
          ROADMAP_NOTE_MAX_LENGTH,
        );
      }
    },
  );

  it('down puts the launch seed back', async () => {
    const { queries, inserted } = await run('down');

    expect(queries[0]).toBe(`DELETE FROM "public_roadmap_items"`);
    expect(inserted.map(({ title }) => title)).toContain('Learner App');
    expect(inserted.map(({ title }) => title)).not.toContain(
      'Helpline Note Taker',
    );
  });
});
