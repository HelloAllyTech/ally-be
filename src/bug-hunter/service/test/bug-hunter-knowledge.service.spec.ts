import { BugHuntLookupKind } from '../../enum/bug-hunt-telemetry.enum';
import { BugHunterKnowledgeService } from '../bug-hunter-knowledge.service';

describe('BugHunterKnowledgeService', () => {
  const finding = {
    id: 'f-1',
    title: 'Simulation titles stay English in Marathi',
    description:
      'Every simulation title and description shows English after selecting Marathi.',
    file: null,
  };

  it('assembles playbooks, look-alikes and feature cards, recording both lookups on the run', async () => {
    const telemetry = { timed: jest.fn((_run, _kind, fetch) => fetch()) };
    const service = new BugHunterKnowledgeService(
      { similar: jest.fn().mockResolvedValue([{ id: 'f-0' }]) } as never,
      { forBug: jest.fn().mockResolvedValue([{ summary: 'card' }]) } as never,
      telemetry as never,
    );
    const k = await service.forFinding(finding, 'run-1');
    expect(k.playbooks[0].id).toBe('content-not-translated');
    expect(k.precedents).toEqual([{ id: 'f-0' }]);
    expect(k.featureCards).toEqual([{ summary: 'card' }]);
    expect(
      telemetry.timed.mock.calls.map(([run, kind]) => [run, kind]),
    ).toEqual([
      ['run-1', BugHuntLookupKind.PRECEDENTS],
      ['run-1', BugHuntLookupKind.FEATURE_MAP],
    ]);
  });

  it('fails soft: a broken lookup costs its half, never the prompt', async () => {
    const service = new BugHunterKnowledgeService(
      {
        similar: jest
          .fn()
          .mockRejectedValue(new Error('syntax error in tsquery')),
      } as never,
      { forBug: jest.fn().mockResolvedValue([]) } as never,
      { timed: jest.fn((_run, _kind, fetch) => fetch()) } as never,
    );
    const k = await service.forFinding(finding);
    expect(k.precedents).toEqual([]);
    expect(k.playbooks.length).toBeGreaterThan(0);
  });
});
