```markdown
# UX Brief: Quiz App — v1 MVP

**Date:** 2026-04-06
**Track:** UX Brief
**Status:** Draft

---

## Overview

A lightweight, fast quiz platform where anyone can create a quiz in under 2 minutes and compete on leaderboards. The experience must feel low-friction for both creators and takers — minimal sign-up walls, immediate feedback, and satisfying competitive loops.

---

## Design Principles

1. **Speed over polish** — Every flow should feel effortless. Reduce steps, not features.
2. **Feedback is the reward** — Instant right/wrong feedback and score reveals are core moments. Design them to feel good.
3. **Anonymous-first, authenticated-better** — Let users take quizzes without signing in. Surface the value of accounts at the right moment (score saved, leaderboard ranking), not at the door.
4. **Creator confidence** — Creators need to feel their quiz is ready to share. Clear publishing state, preview mode, and share UX are essential.

---

## Personas & Primary Jobs-to-Be-Done

| Persona | Primary JTBD | Key Friction to Eliminate |
|---|---|---|
| **Quiz Creator** | Ship a quiz fast and share it | Tedious question entry; uncertainty about publish state |
| **Quiz Taker** | Test myself and see how I did | Friction before starting; unclear results |
| **Competitive User** | See where I rank against others | Leaderboard buried after quiz; no reason to return |

---

## User Flows

### Flow 1: Quiz Creation

```
Sign up / Log in
  → Dashboard (empty state: prominent "Create Quiz" CTA)
    → Quiz Setup: title, description, topic tag
      → Question Builder (loop: add question → set type → add answers → mark correct)
        → Review (question count, estimated time)
          → Publish → Share modal (link + copy button)
```

**Key UX decisions:**
- Question builder is inline, not a separate page per question. No unnecessary navigation.
- Creators set optional per-question timers inline, not in a global settings screen.
- Draft auto-saves every 30 seconds — no explicit save button needed.
- Publish reveals a share modal immediately. Share intent happens at peak motivation.

---

### Flow 2: Quiz Taking

```
Open shared link
  → Quiz intro (title, creator, question count, optional timer notice)
    → [Optional] Sign in prompt (dismissible, benefit-framed: "Sign in to save your score")
      → Question 1 of N (one at a time, no back nav)
        → Answer → Immediate feedback overlay (correct/incorrect + explanation if set)
          → Next question...
            → Final score screen
              → [If not signed in] Sign-in prompt to save score & view leaderboard
              → [If signed in] Score saved → Leaderboard view
```

**Key UX decisions:**
- The sign-in prompt on the intro screen is a banner, not a gate. One tap to dismiss.
- Feedback overlay is brief (1.5–2s auto-advance or tap to continue). Don't break flow.
- Progress indicator (question X of N) is always visible — reduces anxiety and drop-off.
- Final score screen is the emotional high point. Make it feel like a reveal: animate the score.

---

### Flow 3: Leaderboard

```
Final score screen
  → "See Leaderboard" CTA
    → Per-quiz leaderboard (rank, username, score, time)
      → [Optional] "Play again" / "Try another quiz"
```

**Key UX decisions:**
- Leaderboard highlights the current user's row (if authenticated) even if they're not in the top 10.
- Anonymous users see the leaderboard but their score is marked as "Guest — not saved."
- Real-time refresh is silent (no loading spinners mid-view). Scores update in place.

---

## Screen Inventory

| Screen | Priority |
|---|---|
| Dashboard (creator home) | P0 |
| Quiz setup form | P0 |
| Question builder | P0 |
| Quiz preview (creator view) | P1 |
| Publish + share modal | P0 |
| Quiz intro (taker view) | P0 |
| Question screen | P0 |
| Answer feedback overlay | P0 |
| Final score screen | P0 |
| Per-quiz leaderboard | P0 |
| Sign-up / Log-in | P0 |
| Empty states (dashboard, leaderboard) | P1 |
| Error states (quiz not found, expired) | P1 |

---

## Key Interaction Moments

### 1. Question builder — inline add
The builder should feel like a structured document, not a form wizard. Each question is a card. Adding a new question appends a card below. Answer options are added inline with a "+ Add option" affordance. Correct answer is marked with a radio/checkbox per the question type.

### 2. Answer feedback — micro-moment
After selecting an answer, the chosen option state changes immediately (correct = green, incorrect = red + show correct answer). A brief label ("Correct!" / "Not quite") appears. Auto-advance after ~2s. This loop must feel snappy — no perceived lag.

### 3. Score reveal — emotional peak
Final score animates in (count-up from 0, or a circular progress fill). Show: score %, number correct, time taken. Below: per-question breakdown in a collapsed accordion. Primary CTA is "View Leaderboard."

### 4. Sign-in prompt placement
Two surfaces, both non-blocking:
- **Before quiz starts:** Dismissible banner. Copy: "Sign in to save your score and appear on the leaderboard."
- **After quiz ends (if anonymous):** Inline card above the leaderboard. Copy: "Want to save this score? Sign in — it only takes a second."

---

## Open Questions (UX-Relevant)

| Question | UX Impact | Recommendation |
|---|---|---|
| Do anonymous scores count toward leaderboards? | Affects post-quiz CTA and leaderboard display | Show anonymous scores as "Guest" with no username; they appear but don't persist |
| Private/invite-only quizzes? | Adds complexity to publish flow | Defer to v2; keep publish as public-only in v1 |
| Minimum viable moderation for v1? | Affects creator dashboard and report flow | Add a "Report quiz" link on the taker intro screen; no in-app moderation UI needed in v1 |

---

## Accessibility & Responsive Considerations

- Quiz taking must be fully usable on mobile (single-thumb operation for answer selection).
- Timer countdown must not rely on color alone — include a number and optionally a progress bar.
- Answer feedback must be perceivable without color (icon + label, not just green/red).
- Question builder is a secondary priority for mobile in v1 (creators likely on desktop).

---

## Out of Scope (v1)

- Global leaderboard (v2)
- Quiz discovery / search (v2)
- Social sharing cards (v3)
- Creator analytics (v3)
- AI-generated content
- Team/group sessions

---

## Deliverables Expected from Design

- [ ] Wireframes: all P0 screens (desktop + mobile for taker flows)
- [ ] Prototype: end-to-end taker flow (intro → question → feedback → score → leaderboard)
- [ ] Component spec: question builder card, feedback overlay, score reveal, leaderboard row
- [ ] Copy: sign-in prompts, empty states, error states
- [ ] Handoff: annotated specs with interaction notes for all P0 screens
```