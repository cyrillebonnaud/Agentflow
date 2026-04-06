# Mini PRD: Quiz App

## Problem

Users want a lightweight way to create, share, and compete on quizzes across any topic — without needing to build quizzes from scratch or track results manually.

---

## Goals

- Enable anyone to create a quiz in under 2 minutes
- Provide instant scoring feedback after quiz completion
- Surface competitive engagement via leaderboards

---

## Non-goals

- AI-generated quiz content (v1)
- Team/group quiz sessions (v1)
- Monetization or paid tiers (v1)

---

## Users

| Persona | Need |
|---|---|
| **Quiz Creator** | Build and share quizzes quickly |
| **Quiz Taker** | Test knowledge and see how they rank |
| **Competitive User** | Track scores and beat others on leaderboards |

---

## Core Features

### 1. Quiz Creation
- Title, description, topic tag
- Question types: multiple choice, true/false
- Up to 50 questions per quiz
- Publish or save as draft

### 2. Quiz Taking
- Anonymous or authenticated play
- One question at a time, no back navigation
- Timer per question (optional, set by creator)
- Immediate correct/incorrect feedback after each answer

### 3. Scoring
- Score = correct answers / total questions × 100
- Show final score, time taken, and per-question breakdown
- Score saved to leaderboard if user is authenticated

### 4. Leaderboards
- Per-quiz leaderboard: rank, username, score, time
- Global leaderboard: top scores across all quizzes
- Refreshed in real time

---

## User Flows

```
Creator: Sign up → Create quiz → Add questions → Publish → Share link
Taker:   Open link → (Optional) Sign in → Take quiz → See score → View leaderboard
```

---

## Success Metrics

| Metric | Target (90 days post-launch) |
|---|---|
| Quizzes created | 1,000 |
| Quiz completions | 10,000 |
| Return quiz takers (≥2 sessions) | 30% |
| Avg quiz creation time | < 3 min |

---

## Key Risks

| Risk | Mitigation |
|---|---|
| Low-quality or spam quizzes | Report/flag mechanism; creator rate limits |
| Leaderboard manipulation | Server-side score validation; anomaly detection |
| Drop-off mid-quiz | Auto-save progress; resume on return |

---

## Open Questions

1. Should anonymous scores count toward leaderboards, or require sign-in?
2. Do we allow creators to set private quizzes (invite-only)?
3. What's the minimum viable moderation flow for v1?

---

## Scope

**v1 (MVP):** Creation, taking, scoring, per-quiz leaderboard
**v2:** Global leaderboard, quiz discovery/search, categories
**v3:** Timed modes, social sharing cards, creator analytics