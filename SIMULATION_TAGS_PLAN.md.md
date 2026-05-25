# Backend Implementation Plan: Rating-Based Feedback with Tags

## Context

The system currently includes the following APIs:

- `GET /v1/learn/scenario-session/:sessionId`  
  Returns `GetSimulationSummaryResponse` with:
  - `hasFeedback: boolean`
  - `sessionFeedback?: { rating, feedback, issues }`

- `POST /v1/learn/scenario-session/:sessionId/feedback`  
  स्वीकारs:
  - `{ rating: number, feedback?: string }`  
  Returns:
  - `{ id, tenantId, scenarioSessionId, rating, feedback, createdAt, updatedAt }`

The frontend currently uses a helper function `getSimulationRatingData(rating)` that maps a rating (1–5) to:
- `ratingText` (string)
- `tags` (array of strings)

These values are currently hardcoded on the frontend.

---

## Requirements

### 1. Database Design

- Create a new table to store rating metadata:
  - Fields:
    - `rating (int)`
    - `ratingText (string)`
    - `tags (array or JSON)`
- This table should act as the **source of truth** instead of frontend hardcoded values
- Extend the existing scenario session feedback table to include:
  - `tags (array or JSON)` → selected by the user

---

### 2. Backend Changes

- Update the feedback submission API:
  - Accept and store selected `tags`
  - Do **not** accept `ratingText` from frontend

- Modify the summary API:
  - `GET /scenario-session/:sessionId`
  - Include `tags` in `sessionFeedback`

---

### 3. New API

- Create a new endpoint:
  - Returns all rating metadata:
    ```json
    [
      { "rating": 1, "ratingText": "...", "tags": [...] },
      ...
    ]
    ```
- This will replace the frontend helper function

---

### 4. Data Flow

#### Frontend:
- Fetch rating metadata from backend
- Display rating options dynamically
- Submit:
  - `rating`
  - `tags`
  - `feedback`

#### Backend:
- Validate rating (1–5)
- Validate tags against metadata table
- Store selected tags in feedback table

---

### 5. Migration Plan

- Seed the rating metadata table with existing values from `getSimulationRatingData`
- Ensure backward compatibility for:
  - Existing feedback records without tags
- Decide fallback behavior for old records
- give me commands to enerate migration file

---

## Deliverable

Provide a structured implementation plan including:

- Overview
- Database Schema Changes
- API Changes
- Migration Plan
- Risks
- Open Questions

---

## Clarifications Needed

Before implementation, confirm:

- Should tags be strictly validated against predefined values? : No
- Can users select multiple tags or only one? : Multiple
- How should legacy feedback (without tags) be handled in UI? : there will be no selected tags in frontend