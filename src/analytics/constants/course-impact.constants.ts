/**
 * Course impact (Highlights → Course impact): did a course's learners do better
 * on the foundational helping skills after the course than before it?
 *
 * The ruler is the scenario-independent helping-skills measure
 * (src/foundational-skills): every learner's roleplay speech is cut into
 * 5,000-character slices and each slice is scored 1–4 on one fixed rubric, so
 * every course is read on the same scale whatever its scenarios.
 */

/**
 * How many scored slices each side of the course a learner's before/after
 * score averages over: the LAST this-many that closed before they started the
 * course, and the FIRST this-many made wholly after they finished it.
 *
 * Nearest to the course on purpose — slices from months earlier say more about
 * where the learner was then than where they were when the course began. More
 * than one because a single slice is noisy (the Helping skills tab's precision
 * card puts a number on how noisy); a learner with only one slice on a side
 * still counts, they just carry more of that noise into the group interval.
 */
export const COURSE_IMPACT_WINDOW_CUTS = 3;

/**
 * Seeded competency name → helping-skills rubric key, so a course can be read
 * on the skills it actually teaches.
 *
 * A course's roleplay items each name the competencies they assess
 * (`scenarios.competencyIds`); the seeded competencies are the same 15 skills
 * as the rubric under slightly different names. This map is the exact-name
 * table from docs/foundational-helping-skills.md §9.
 *
 * Deliberately absent:
 *  - **Non-Verbal Communication** — the rubric has the skill, but the passive
 *    measure scores 14 of the 15 and this is the one it cannot see in a
 *    transcript, so there is nothing to compare.
 *  - **Linking Emotions, Thoughts & Behaviours** — §9 marks it a DIFFERENT
 *    skill from the rubric's `functioning` (a cognitive-behavioural framing),
 *    so claiming a course that teaches it targets `functioning` would credit
 *    the course with a skill it does not teach.
 *
 * Custom and admin-created competencies are not mapped either: their names say
 * nothing reliable about which rubric skill they mean. A course whose
 * competencies map to nothing simply has no targeted skills — every skill is
 * still shown, none is highlighted.
 */
export const COURSE_IMPACT_COMPETENCY_SKILLS: Readonly<Record<string, string>> =
  {
    'Verbal Communication': 'verbal',
    'Explain & Promote Confidentiality': 'confidentiality',
    'Rapport Building & Self-Disclosure': 'rapport',
    'Exploration & Normalization of Feelings': 'feelings',
    'Empathy, Warmth & Genuineness': 'empathy',
    'Assessment of Harm & Response Planning': 'harm',
    "Explore Client's Explanation for Problem": 'explanation',
    'Involvement of Family & Significant Others': 'family',
    'Collaborative Goal Setting': 'goals',
    'Promote Realistic Hope': 'hope',
    'Strengthen Coping Strategies': 'coping',
    'Psychoeducation with Local Terminology': 'psychoeducation',
    'Elicitation of Feedback': 'feedback',
  };
