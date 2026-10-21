import {
  BuilderPrdDocument,
  BuilderTechnicalDesign,
} from '../type/builder-prd.type';

/**
 * The PRD and technical design as markdown: what an issue build's spec
 * (BuilderPipelineController.getSpec) and the design prompts render.
 */

export const renderPrd = (prd: BuilderPrdDocument): string => {
  const requirements = (prd.requirements ?? [])
    .map((requirement) => {
      const criteria = Array.isArray(requirement.acceptanceCriteria)
        ? requirement.acceptanceCriteria
        : [];
      const criteriaList = criteria.length
        ? criteria.map((criterion) => `    - ${criterion}`).join('\n')
        : '    - (none stated — treat this as a gap and say so in your report)';
      return `- **${requirement.id} — ${requirement.title}**\n  ${requirement.description}\n  Acceptance criteria:\n${criteriaList}`;
    })
    .join('\n\n');

  const repoPlans = (prd.technicalPlan?.repos ?? [])
    .map((plan) => `#### ${plan.repo}\n\n${plan.changesMd}`)
    .join('\n\n');

  const assumptions = (prd.assumptions ?? [])
    .map((assumption) => `- [${assumption.status}] ${assumption.text}`)
    .join('\n');

  return `
# PRD — ${prd.title}

## Summary
${prd.summary}

## Problem
${prd.problem}

## Users & context
${prd.usersAndContext}

## What already exists
${prd.existingBehaviour || '(not established — treat every claim below as unverified and check before building)'}

## Where the change belongs
${prd.whereChangesBelong || '(not established — if the change you are about to make is not in the layer that owns the behaviour, say so rather than patching the layer you were given)'}

## Goals
${prd.goals}

## Non-goals
${prd.nonGoals}

## Requirements
${requirements || '(none)'}

## Assumptions
${assumptions || '(none)'}

## Technical plan
${repoPlans || '(none)'}

${prd.technicalPlan?.dataModelMd ? `### Data model\n${prd.technicalPlan.dataModelMd}\n` : ''}
${prd.technicalPlan?.apiMd ? `### API\n${prd.technicalPlan.apiMd}\n` : ''}

## Test plan
${prd.testPlanMd}

## End-to-end checks
${prd.e2ePlanMd}
${renderApprovedDesign(prd)}
`.trim();
};

/**
 * The approved technical design, appended to the PRD a build works from.
 *
 * Only once approved. A design in review is a draft a person has not agreed
 * to, and a build reading it would treat the designer's guesses as settled.
 * The PRD's own technical plan above it is a sketch; where the two disagree,
 * this is the one that was checked against the code and approved.
 */
const renderApprovedDesign = (prd: BuilderPrdDocument): string => {
  const design = prd.technicalDesign;
  if (!design || design.status !== 'approved') return '';

  return `
## Technical design (approved)

Written with the code checked out, critiqued, and approved by a person. Where
it and the technical plan above disagree, follow this. The scope below is the
files this build may change.

${renderTechnicalDesign(design)}
`;
};

/**
 * A technical design as markdown, whatever its status. Shared by the approved
 * block above and the design critic, which reads the submission before anyone
 * has approved it.
 */
export const renderTechnicalDesign = (
  design: BuilderTechnicalDesign,
): string => {
  const scope = (design.scope ?? [])
    .map(
      (entry) =>
        `- **${entry.repo}**\n${(entry.files ?? [])
          .map((file) => `  - \`${file}\``)
          .join('\n')}`,
    )
    .join('\n');
  const contracts = (design.contracts ?? [])
    .map(
      (contract) =>
        `- **${contract.name}** — ${contract.change}\n  Readers:\n${(
          contract.readers ?? []
        )
          .map((reader) => `  - \`${reader}\``)
          .join('\n')}`,
    )
    .join('\n');
  const tests = (design.testMap ?? [])
    .map(
      (test) =>
        `- **${test.requirementId}** — \`${test.repo}:${test.file}\`: ${test.asserts}`,
    )
    .join('\n');
  const decisions = (design.openDecisions ?? [])
    .map((decision) => `- ${decision}`)
    .join('\n');

  return `
${design.designMd || '(no design written)'}

### Scope — the files this build may change
${scope || '(none)'}

### Contracts changed, and who reads them
${contracts || '(none — no stored field, API field, enum or table changes)'}

### Compatibility
${design.compatibilityMd || '(no changed contracts)'}

### Test map
${tests || '(none)'}
${decisions ? `\n### Open decisions\n${decisions}\n` : ''}`.trim();
};
