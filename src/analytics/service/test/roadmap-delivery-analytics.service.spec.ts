import { Test, TestingModule } from '@nestjs/testing';
import { RoadmapDeliveryAnalyticsService } from '../roadmap-delivery-analytics.service';
import {
  ROADMAP_DELIVERY_MAX_OWNERS,
  ROADMAP_DELIVERY_OTHER_LABEL,
  ROADMAP_DELIVERY_UNASSIGNED_LABEL,
  RoadmapDeliveryAnalyticsRepository,
  RoadmapDeliveryRow,
  RoadmapUndatedRow,
} from '../../repository/roadmap-delivery-analytics.repository';
import { RoadmapOpportunityType } from '../../../product-roadmap/enum/roadmap-opportunity.enum';

/** Fixed "now" = 2026-08-10, so the current (incomplete) month is 2026-08. */
const FIXED_NOW = new Date('2026-08-10T12:00:00.000Z');

const row = (
  month: string,
  owner: string | null,
  coins: number,
  opportunities = 1,
  type = RoadmapOpportunityType.IDEA,
): RoadmapDeliveryRow => ({ month, owner, type, opportunities, coins });

const ownerCoins = (
  result: {
    months: { month: string; owners: { owner: string; coins: number }[] }[];
  },
  month: string,
  owner: string,
): number | undefined =>
  result.months
    .find((m) => m.month === month)
    ?.owners.find((o) => o.owner === owner)?.coins;

describe('RoadmapDeliveryAnalyticsService', () => {
  let service: RoadmapDeliveryAnalyticsService;

  const setup = async (
    dated: RoadmapDeliveryRow[] = [],
    undated: RoadmapUndatedRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapDeliveryAnalyticsService,
        {
          provide: RoadmapDeliveryAnalyticsRepository,
          useValue: {
            getDatedReleased: jest.fn().mockResolvedValue(dated),
            getUndatedReleased: jest.fn().mockResolvedValue(undated),
          },
        },
      ],
    }).compile();

    service = module.get(RoadmapDeliveryAnalyticsService);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('echoes the reserved labels, the owner ceiling and the current month', async () => {
    await setup();

    const result = await service.getRoadmapDelivery();

    expect(result.unassignedOwnerLabel).toBe(ROADMAP_DELIVERY_UNASSIGNED_LABEL);
    expect(result.otherOwnerLabel).toBe(ROADMAP_DELIVERY_OTHER_LABEL);
    expect(result.maxOwners).toBe(ROADMAP_DELIVERY_MAX_OWNERS);
    expect(result.currentMonth).toBe('2026-08-01');
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('returns no months at all when nothing released carries a date', async () => {
    // THE POINT: an axis of nothing but zeros reads as "we have shipped nothing
    // ever", which is a different claim from "nothing we shipped is dated". The
    // client needs an empty months list so it can show an empty state instead.
    await setup(
      [],
      [{ type: RoadmapOpportunityType.IDEA, opportunities: 173, coins: 604 }],
    );

    const result = await service.getRoadmapDelivery();

    expect(result.months).toEqual([]);
    expect(result.plotted.coins).toBe(0);
    expect(result.undated.coins).toBe(604);
    expect(result.undated.opportunities).toBe(173);
  });

  it('fills the gap months between releases with real zeros', async () => {
    await setup([row('2026-05-01', 'Ajey', 40), row('2026-08-01', 'Ajey', 10)]);

    const result = await service.getRoadmapDelivery();

    expect(result.months.map((m) => m.month)).toEqual([
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
    ]);
    expect(result.months[1]).toMatchObject({
      coins: 0,
      opportunities: 0,
      owners: [],
    });
  });

  it('runs the axis through to the current month even with no release in it', async () => {
    await setup([row('2026-06-01', 'Ajey', 40)]);

    const result = await service.getRoadmapDelivery();

    expect(result.months.map((m) => m.month)).toEqual([
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
    ]);
  });

  it('flags the current month as partial and nothing else', async () => {
    await setup([row('2026-07-01', 'Ajey', 40), row('2026-08-01', 'Ajey', 10)]);

    const result = await service.getRoadmapDelivery();

    expect(result.months.map((m) => m.partial)).toEqual([false, true]);
  });

  it('extends the axis past today to cover a future-dated release', async () => {
    // A row outside the axis would vanish from the bars while staying in
    // `plotted`, so the two would disagree with nothing on screen to explain it.
    await setup([row('2026-08-01', 'Ajey', 10), row('2026-10-01', 'Gopi', 25)]);

    const result = await service.getRoadmapDelivery();

    expect(result.months.map((m) => m.month)).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    const plottedFromBars = result.months.reduce((sum, m) => sum + m.coins, 0);
    expect(plottedFromBars).toBe(result.plotted.coins);
  });

  it('sums coins per owner per month and keeps the month total consistent', async () => {
    await setup([
      row('2026-07-01', 'Ajey', 40, 2),
      row('2026-07-01', 'Gopi', 15, 1),
      row('2026-07-01', 'Ajey', 5, 1, RoadmapOpportunityType.BUG),
    ]);

    const result = await service.getRoadmapDelivery();
    const july = result.months.find((m) => m.month === '2026-07-01');

    expect(july).toMatchObject({
      coins: 60,
      opportunities: 4,
      ideaCoins: 55,
      bugCoins: 5,
      ideaOpportunities: 3,
      bugOpportunities: 1,
    });
    expect(ownerCoins(result, '2026-07-01', 'Ajey')).toBe(45);
    expect(ownerCoins(result, '2026-07-01', 'Gopi')).toBe(15);
  });

  it('keeps the type splits reconciling with the totals', async () => {
    await setup([
      row('2026-07-01', 'Ajey', 40, 2),
      row('2026-07-01', 'Ajey', 5, 1, RoadmapOpportunityType.BUG),
    ]);

    const { plotted } = await service.getRoadmapDelivery();

    expect(plotted.ideaCoins + plotted.bugCoins).toBe(plotted.coins);
    expect(plotted.ideaOpportunities + plotted.bugOpportunities).toBe(
      plotted.opportunities,
    );
  });

  it('bands owner-less releases as Unassigned rather than dropping them', async () => {
    await setup([row('2026-07-01', 'Ajey', 40), row('2026-07-01', null, 12)]);

    const result = await service.getRoadmapDelivery();

    expect(
      ownerCoins(result, '2026-07-01', ROADMAP_DELIVERY_UNASSIGNED_LABEL),
    ).toBe(12);
    expect(result.months.find((m) => m.month === '2026-07-01')?.coins).toBe(52);
  });

  it('orders owners by all-time coins with the context bands last', async () => {
    await setup([
      row('2026-06-01', 'Gopi', 10),
      row('2026-07-01', 'Ajey', 40),
      row('2026-07-01', null, 500),
    ]);

    const result = await service.getRoadmapDelivery();

    // Unassigned is last despite being the largest: it stacks as context on top,
    // so the owners below keep a fixed baseline month to month.
    expect(result.owners).toEqual([
      'Ajey',
      'Gopi',
      ROADMAP_DELIVERY_UNASSIGNED_LABEL,
    ]);
  });

  it('uses the same owner order inside every month', async () => {
    await setup([
      row('2026-06-01', 'Gopi', 10),
      row('2026-06-01', 'Ajey', 5),
      row('2026-07-01', 'Ajey', 40),
      row('2026-07-01', 'Gopi', 1),
    ]);

    const result = await service.getRoadmapDelivery();
    const orderIn = (month: string) =>
      result.months.find((m) => m.month === month)?.owners.map((o) => o.owner);

    // Ajey outranks Gopi on all-time coins (45 vs 11), so Ajey comes first in
    // BOTH months — including June, where Gopi shipped more.
    expect(result.owners).toEqual(['Ajey', 'Gopi']);
    expect(orderIn('2026-06-01')).toEqual(['Ajey', 'Gopi']);
    expect(orderIn('2026-07-01')).toEqual(['Ajey', 'Gopi']);
  });

  it('leaves every owner named while the ceiling is not exceeded', async () => {
    const owners = Array.from(
      { length: ROADMAP_DELIVERY_MAX_OWNERS + 1 },
      (_, i) => row('2026-07-01', `Owner ${i}`, 100 - i),
    );
    await setup(owners);

    const result = await service.getRoadmapDelivery();

    // One owner over the ceiling would make "Other owners" a grey band naming a
    // single person less clearly than their own name does.
    expect(result.owners).toHaveLength(ROADMAP_DELIVERY_MAX_OWNERS + 1);
    expect(result.owners).not.toContain(ROADMAP_DELIVERY_OTHER_LABEL);
  });

  it('rolls the tail past the ceiling into one band, ranked all-time', async () => {
    const owners = Array.from(
      { length: ROADMAP_DELIVERY_MAX_OWNERS + 2 },
      (_, i) => row('2026-07-01', `Owner ${i}`, 100 - i),
    );
    await setup(owners);

    const result = await service.getRoadmapDelivery();

    expect(result.owners).toHaveLength(ROADMAP_DELIVERY_MAX_OWNERS + 1);
    expect(result.owners[result.owners.length - 1]).toBe(
      ROADMAP_DELIVERY_OTHER_LABEL,
    );
    // The two weakest owners (coins 92 and 91) are the ones rolled up.
    expect(ownerCoins(result, '2026-07-01', ROADMAP_DELIVERY_OTHER_LABEL)).toBe(
      183,
    );
    // Nothing is lost in the roll-up.
    expect(result.months[0].coins).toBe(
      owners.reduce((sum, o) => sum + o.coins, 0),
    );
  });
});
