import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { COURSE_IMPACT_WINDOW_CUTS } from '../constants/course-impact.constants';
import {
  CourseProgressAnalyticsQueryDto,
  KnowledgeVsSkillResponseDto,
  ProgressCurveResponseDto,
} from '../dto/course-progress-analytics.dto';
import { CourseProgressAnalyticsRepository } from '../repository/course-progress-analytics.repository';
// One floor for every judged score and rate on the platform.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  buildKnowledgeVsSkill,
  buildProgressCurve,
  MIN_POINTS_FOR_CORRELATION,
  PROGRESS_CURVE_CHART_COURSES,
} from '../util/course-progress-analytics.util';

/**
 * Slices averaged for a learner's skill score in the knowledge-vs-skill
 * chart: course impact's window, twice — the course impact "after" side
 * reads 3 slices made after FINISHING; this reads the slices made from
 * ENROLLING onwards, which spans the course itself and the time after it.
 */
export const KNOWLEDGE_SKILL_WINDOW_CUTS = COURSE_IMPACT_WINDOW_CUTS * 2;

/**
 * Highlights → Curriculum: where in each course its learners stop (AAQ-225),
 * and whether quiz knowledge goes with roleplay skill (AAQ-226). All time;
 * scoped by the learner's own org. With no enrolments both return empty
 * lists and zero counts, never a 404.
 */
@Injectable()
export class CourseProgressAnalyticsService {
  constructor(private readonly repository: CourseProgressAnalyticsRepository) {}

  async getProgressCurve(
    query: CourseProgressAnalyticsQueryDto = {},
  ): Promise<ProgressCurveResponseDto> {
    const tenantId = query.tenantId;
    const [items, enrollments] = await Promise.all([
      this.repository.getLiveTrackItems(),
      this.repository.getProgressEnrollments(tenantId),
    ]);
    const built = buildProgressCurve(items, enrollments, {
      floor: MIN_SCORE_SAMPLE_SIZE,
      chartCourses: PROGRESS_CURVE_CHART_COURSES,
    });

    return {
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      chartCourses: PROGRESS_CURVE_CHART_COURSES,
      ...built,
      provenance: {
        derivation:
          'R10 (course progress: track_enrollments + track_item_progress). Per course, its live items ' +
          'in the order the engine unlocks them (sections by order, then items by order); x = item ' +
          'position scaled 0–100 from first to last item; y = share of STARTED enrolments (opened or ' +
          'completed an item, or finished) whose furthest unlocked item is at or beyond it — a finished ' +
          'enrolment reached every item. A course needs ' +
          `${MIN_SCORE_SAMPLE_SIZE} started enrolments to be drawn; the ${PROGRESS_CURVE_CHART_COURSES} ` +
          'with the most are drawn and the rest listed. All time; test organisations excluded; scoped ' +
          "by the learner's own org.",
        note:
          'Items unlock one at a time, so "reached" means unlocked, not opened: a learner who finished ' +
          'item 3 has reached item 4 even if they never opened it (the opened share shows that gap). ' +
          'The steepest drop names the item learners stopped AT. Courses edited after learners ' +
          'enrolled are read on their current item list.',
      },
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  async getKnowledgeVsSkill(
    query: CourseProgressAnalyticsQueryDto = {},
  ): Promise<KnowledgeVsSkillResponseDto> {
    const tenantId = query.tenantId;
    const [enrollments, attempts, cuts] = await Promise.all([
      this.repository.getQuizCourseEnrollments(tenantId),
      this.repository.getFirstQuizAttempts(tenantId),
      this.repository.getScoredCuts(FHS_RUBRIC_VERSION, tenantId),
    ]);
    const built = buildKnowledgeVsSkill(enrollments, attempts, cuts, {
      window: KNOWLEDGE_SKILL_WINDOW_CUTS,
      floor: MIN_POINTS_FOR_CORRELATION,
    });

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_POINTS_FOR_CORRELATION,
      scoreDomain: [1, 4],
      quizScoreDomain: [0, 100],
      skillWindowCuts: KNOWLEDGE_SKILL_WINDOW_CUTS,
      ...built,
      provenance: {
        derivation:
          'R5 × R1. One point per learner per course. x = mean FIRST-attempt quiz score (0–100) over ' +
          "the course's quizzes (track_quiz_attempts, attemptNumber 1; pending or ungraded first " +
          `attempts left out). y = mean helping-skills composite (1–4) of the learner's first ` +
          `${KNOWLEDGE_SKILL_WINDOW_CUTS} scored ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character ` +
          `slices made wholly after enrolling, scored by ${FHS_JUDGE_MODEL} on rubric ` +
          `${FHS_RUBRIC_VERSION}. Spearman rank correlation with a 95% bootstrap interval that ` +
          `resamples learners; withheld below ${MIN_POINTS_FOR_CORRELATION} points. All time; test ` +
          "organisations excluded; scoped by the learner's own org.",
        note:
          'Both measures are noisy — a quiz is a few questions, a slice score is one AI judge reading — ' +
          'so a weak r is expected and still informative: knowledge may not be what holds learners ' +
          'back, or the quiz may not test the skill. Associated with, not caused by. Pooled r mixes ' +
          'quizzes of different difficulty; read a course on its own where it has enough points. AI ' +
          'judge not yet checked against human raters.',
      },
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
