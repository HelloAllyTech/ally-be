import { BugFindingSeverity } from '../../enum/bug-finding.enum';
import {
  composeBugReportDescription,
  repoForSurface,
  severityForImpact,
} from '../bug-report-brief.util';

describe('bug report brief', () => {
  it('maps a surface to its repo and leaves "not sure" and junk to the classifier', () => {
    expect(repoForSurface('helpline_web')).toBe('ally-web');
    expect(repoForSurface('admin')).toBe('ally-web');
    expect(repoForSurface('mobile')).toBe('ally-mobile');
    expect(repoForSurface('voice_roleplay')).toBe('ally-ai-learn');
    expect(repoForSurface('whatsapp')).toBe('ally-be');
    expect(repoForSurface('not_sure')).toBeNull();
    expect(repoForSurface('ally-be')).toBeNull();
    expect(repoForSurface(undefined)).toBeNull();
  });

  it("turns the reporter's impact into a severity, and nothing else into nothing", () => {
    expect(severityForImpact('blocks')).toBe(BugFindingSeverity.HIGH);
    expect(severityForImpact('wrong')).toBe(BugFindingSeverity.MEDIUM);
    expect(severityForImpact('cosmetic')).toBe(BugFindingSeverity.LOW);
    expect(severityForImpact('high')).toBeNull();
  });

  it("folds the structured answers into one brief with the reporter's words first", () => {
    const brief = composeBugReportDescription(
      'Marathi labels show English on the course page.',
      {
        expected: 'Every label in Marathi.',
        steps: '1. Pick Marathi\n2. Open any course',
        surface: 'helpline_web',
        screen: '/product-roadmap?tab=bugs',
        happenedAt: '2026-10-09T08:00:00.000Z',
        frequency: 'every_time',
        impact: 'wrong',
        identifiers: 'tenant ally, user 4421',
        language: 'mr',
      },
      1000,
    );
    expect(brief).toBe(
      [
        'Marathi labels show English on the course page.',
        '',
        'Expected: Every label in Marathi.',
        'Steps: 1. Pick Marathi 2. Open any course',
        'Where: Helpline web app, reported from /product-roadmap?tab=bugs',
        'When: 2026-10-09T08:00:00.000Z',
        'How often: every time',
        'Impact: gives a wrong result',
        'Identifiers: tenant ally, user 4421',
        'Language: mr',
      ].join('\n'),
    );
  });

  it('ignores values off the menus, says where it was reported from when the surface is unknown, and keeps the whole thing within the limit', () => {
    const brief = composeBugReportDescription(
      'x'.repeat(900),
      {
        surface: 'not_sure',
        screen: '/bugs',
        frequency: 'always',
        impact: 'p0',
        expected: 'y'.repeat(300),
      },
      1000,
    );
    expect(brief.length).toBeLessThanOrEqual(1000);
    expect(brief).toContain('Reported from: /bugs');
    expect(brief).not.toContain('How often');
    expect(brief).not.toContain('Impact');
    // the reporter's words were shortened to make room, but kept most of the space
    expect(brief.indexOf('Expected:')).toBeGreaterThan(500);

    expect(composeBugReportDescription('plain', null, 1000)).toBe('plain');
    expect(composeBugReportDescription('plain', {}, 1000)).toBe('plain');
  });
});
