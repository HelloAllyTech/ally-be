import { BadRequestException } from '@nestjs/common';
import {
  computeStructuralSignature,
  validateTrackStructure,
} from '../track-structure.validator';
import { TrackItemType } from '../../type/track.type';
import {
  BranchingScenarioContent,
  branchingEndingScore,
  resolveBranchingPath,
} from '../../type/branching.type';
import { UpsertTrackSectionDto } from '../../dto/upsert-track-structure.dto';

function scenario(
  overrides: Partial<BranchingScenarioContent> = {},
): BranchingScenarioContent {
  return {
    startNodeId: 'start',
    nodes: [
      {
        id: 'start',
        text: 'A client says she is a terrible mother.',
        choices: [
          { id: 'c1', text: 'Reassure her', nextNodeId: 'quiet' },
          { id: 'c2', text: 'Reflect the feeling', nextNodeId: 'open' },
        ],
      },
      { id: 'quiet', text: 'She goes quiet.', outcome: 'MIXED' as any },
      {
        id: 'open',
        text: 'She opens up.',
        outcome: 'POSITIVE' as any,
        takeaway: 'Naming the feeling keeps her talking.',
      },
    ],
    ...overrides,
  };
}

const wrap = (content: unknown): UpsertTrackSectionDto[] => [
  {
    title: 'S',
    order: 1,
    items: [
      {
        type: TrackItemType.BRANCHING_SCENARIO,
        order: 1,
        title: 'Self-critical client',
        content: content as any,
      },
    ],
  },
];

describe('validateTrackStructure - branching scenario', () => {
  it('accepts a one-decision scenario', () => {
    expect(() => validateTrackStructure(wrap(scenario()))).not.toThrow();
  });

  it('accepts a loop as long as an ending is reachable from every scene', () => {
    const content = scenario();
    content.nodes[0].choices![0].nextNodeId = 'start';
    content.nodes[0].choices!.push({
      id: 'c3',
      text: 'Stay silent',
      nextNodeId: 'quiet',
    });
    expect(() => validateTrackStructure(wrap(content))).not.toThrow();
  });

  it('rejects an empty scenario', () => {
    expect(() =>
      validateTrackStructure(wrap({ startNodeId: 'x', nodes: [] })),
    ).toThrow(BadRequestException);
  });

  it('rejects a start scene that does not exist', () => {
    expect(() =>
      validateTrackStructure(wrap(scenario({ startNodeId: 'nope' }))),
    ).toThrow(/first scene/);
  });

  it('rejects a choice that leads nowhere', () => {
    const content = scenario();
    content.nodes[0].choices![0].nextNodeId = 'missing';
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      /does not lead to a scene/,
    );
  });

  it('rejects a scene with a single choice', () => {
    const content = scenario();
    content.nodes[0].choices = [content.nodes[0].choices![0]];
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      /2 to 6 choices/,
    );
  });

  it('rejects a scene with more than four choices', () => {
    const content = scenario();
    content.nodes[0].choices = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(
      (id) => ({
        id,
        text: id,
        nextNodeId: 'open',
      }),
    );
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a scene that cannot be reached', () => {
    const content = scenario();
    content.nodes.push({ id: 'island', text: 'Nobody gets here.' });
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      /cannot be reached/,
    );
  });

  it('rejects a loop with no way out', () => {
    const content: BranchingScenarioContent = {
      startNodeId: 'a',
      nodes: [
        {
          id: 'a',
          text: 'A',
          choices: [
            { id: 'c1', text: 'to b', nextNodeId: 'b' },
            { id: 'c2', text: 'to b again', nextNodeId: 'b' },
          ],
        },
        {
          id: 'b',
          text: 'B',
          choices: [
            { id: 'c3', text: 'to a', nextNodeId: 'a' },
            { id: 'c4', text: 'to a again', nextNodeId: 'a' },
          ],
        },
      ],
    };
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      /at least one ending/,
    );
  });

  it('rejects an outcome on a scene that has choices', () => {
    const content = scenario();
    content.nodes[0].outcome = 'POSITIVE' as any;
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      /only an ending/,
    );
  });

  it('rejects duplicate choice ids across scenes', () => {
    const content = scenario();
    content.nodes[1].choices = [
      { id: 'c1', text: 'again', nextNodeId: 'open' },
      { id: 'c9', text: 'other', nextNodeId: 'open' },
    ];
    delete content.nodes[1].outcome;
    expect(() => validateTrackStructure(wrap(content))).toThrow(/share the id/);
  });

  it('rejects a non-https image', () => {
    const content = scenario();
    content.nodes[0].image = { url: 'http://example.com/a.png' };
    expect(() => validateTrackStructure(wrap(content))).toThrow(/https/);
  });

  it('accepts an https image with alt text', () => {
    const content = scenario();
    content.nodes[0].image = {
      url: 'https://bucket.s3.ap-south-1.amazonaws.com/track-media/a.png',
      alt: 'A woman sitting',
    };
    expect(() => validateTrackStructure(wrap(content))).not.toThrow();
  });
});

describe('validateTrackStructure - branching scenario at scale', () => {
  it('accepts branches that re-join and many different endings', () => {
    // start -> a|b|c ; a and b both lead to "mid" (re-join), c to its own ending;
    // mid -> x|y ; four distinct endings in total.
    const content: BranchingScenarioContent = {
      startNodeId: 'start',
      nodes: [
        {
          id: 'start',
          text: 's',
          choices: [
            { id: 's1', text: 'a', nextNodeId: 'a' },
            { id: 's2', text: 'b', nextNodeId: 'b' },
            { id: 's3', text: 'c', nextNodeId: 'endC' },
          ],
        },
        {
          id: 'a',
          text: 'a',
          choices: [
            { id: 'a1', text: 'on', nextNodeId: 'mid' },
            { id: 'a2', text: 'stop', nextNodeId: 'endA' },
          ],
        },
        {
          id: 'b',
          text: 'b',
          choices: [
            { id: 'b1', text: 'on', nextNodeId: 'mid' },
            { id: 'b2', text: 'stop', nextNodeId: 'endB' },
          ],
        },
        {
          id: 'mid',
          text: 'm',
          choices: [
            { id: 'm1', text: 'x', nextNodeId: 'endX' },
            { id: 'm2', text: 'y', nextNodeId: 'endY' },
          ],
        },
        { id: 'endA', text: 'A', outcome: 'MIXED' as any },
        { id: 'endB', text: 'B', outcome: 'NEGATIVE' as any },
        { id: 'endC', text: 'C', outcome: 'NEGATIVE' as any },
        { id: 'endX', text: 'X', outcome: 'POSITIVE' as any },
        { id: 'endY', text: 'Y', outcome: 'MIXED' as any },
      ],
    };
    expect(() => validateTrackStructure(wrap(content))).not.toThrow();
    // Both routes through the re-join reach the same ending.
    expect(resolveBranchingPath(content, ['s1', 'a1', 'm1'])).toBe('endX');
    expect(resolveBranchingPath(content, ['s2', 'b1', 'm1'])).toBe('endX');
  });

  it('accepts a 100-scene chain and rejects 101', () => {
    const chain = (count: number): BranchingScenarioContent => {
      const nodes: BranchingScenarioContent['nodes'] = [];
      for (let i = 0; i < count - 1; i++) {
        nodes.push({
          id: `n${i}`,
          text: `scene ${i}`,
          choices: [
            { id: `n${i}-go`, text: 'on', nextNodeId: `n${i + 1}` },
            { id: `n${i}-out`, text: 'out', nextNodeId: `n${count - 1}` },
          ],
        });
      }
      nodes.push({
        id: `n${count - 1}`,
        text: 'end',
        outcome: 'POSITIVE' as any,
      });
      return { startNodeId: 'n0', nodes };
    };
    expect(() => validateTrackStructure(wrap(chain(100)))).not.toThrow();
    expect(() => validateTrackStructure(wrap(chain(101)))).toThrow(
      /at most 100/,
    );
  });
});

describe('validateTrackStructure - branching scenario scoring', () => {
  it('accepts a pass mark an ending can reach', () => {
    const content = scenario({ settings: { passScore: 70, maxAttempts: 3 } });
    expect(() => validateTrackStructure(wrap(content))).not.toThrow();
  });

  it('rejects a pass mark no ending can reach', () => {
    const content = scenario({ settings: { passScore: 70 } });
    content.nodes[2].score = 60;
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      /nobody could pass/,
    );
  });

  it('uses an explicit ending score over its outcome', () => {
    const content = scenario({ settings: { passScore: 90 } });
    content.nodes[1].score = 95;
    expect(() => validateTrackStructure(wrap(content))).not.toThrow();
  });

  it('rejects a pass mark outside 0-100 and a zero attempt limit', () => {
    expect(() =>
      validateTrackStructure(wrap(scenario({ settings: { passScore: 120 } }))),
    ).toThrow(BadRequestException);
    expect(() =>
      validateTrackStructure(wrap(scenario({ settings: { maxAttempts: 0 } }))),
    ).toThrow(BadRequestException);
  });

  it('rejects a score on a scene that has choices', () => {
    const content = scenario();
    content.nodes[0].score = 50;
    expect(() => validateTrackStructure(wrap(content))).toThrow(
      /only an ending/,
    );
  });

  it('scores an ending from its own score, then its tone, then full marks', () => {
    expect(branchingEndingScore({ id: 'a', text: 't', score: 40 })).toBe(40);
    expect(
      branchingEndingScore({
        id: 'a',
        text: 't',
        outcome: 'MIXED' as any,
      }),
    ).toBe(50);
    expect(branchingEndingScore({ id: 'a', text: 't' })).toBe(100);
  });
});

describe('computeStructuralSignature - branching scenario', () => {
  it('ignores rewording but not rewiring', () => {
    const base = scenario();
    const reworded = scenario();
    reworded.nodes[0].text = 'Different words';
    reworded.nodes[0].choices![0].text = 'Different choice words';
    const rewired = scenario();
    rewired.nodes[0].choices![0].nextNodeId = 'open';

    expect(computeStructuralSignature(wrap(reworded))).toBe(
      computeStructuralSignature(wrap(base)),
    );
    expect(computeStructuralSignature(wrap(rewired))).not.toBe(
      computeStructuralSignature(wrap(base)),
    );
  });
});

describe('resolveBranchingPath', () => {
  const content = scenario();

  it('returns the ending for a legal path', () => {
    expect(resolveBranchingPath(content, ['c2'])).toBe('open');
  });

  it('rejects a choice that is not on the current scene', () => {
    expect(resolveBranchingPath(content, ['nope'])).toBeNull();
  });

  it('rejects a path that stops before an ending', () => {
    expect(resolveBranchingPath(content, [])).toBeNull();
  });

  it('rejects a path that keeps going past an ending', () => {
    expect(resolveBranchingPath(content, ['c2', 'c1'])).toBeNull();
  });
});
