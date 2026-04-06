```markdown
# UX Direction: Quiz App — v1 MVP

**Date:** 2026-04-06
**Status:** Direction — Ready for Wireframes
**Follows from:** UX Brief v1

---

## North Star

The quiz experience should feel closer to a game than a form. Speed, feedback, and rank are the reward loop. Every design decision should be evaluated against: *does this make the loop faster and more satisfying?*

---

## Visual Language Direction

**Tone:** Confident, playful, focused. Not childish — think Duolingo's discipline without the owl.

**Layout philosophy:**
- High contrast between the active element and everything else. One thing demands attention at a time.
- Large tap targets throughout the taker flow — minimum 48px height on interactive elements.
- Generous whitespace on question screens. The question is the hero. Don't clutter it.

**Typography:**
- Question text: large, high-contrast, single weight. No decorative fonts.
- UI chrome (progress, timer, nav): small, recessive. It supports — it doesn't compete.

**Color use:**
- Feedback states (correct/incorrect) must use icon + label + color. Never color alone.
- Timer urgency should use a progress bar that changes color (green → yellow → red) *and* a visible countdown number.
- Leaderboard rank highlight: background tint + bold text on the current user's row. Don't rely solely on color.

---

## Flow-by-Flow Direction

### Creation Flow

**Goal:** A creator should be able to go from blank to published in under 2 minutes.

**Dashboard — empty state:**
- The empty state is a conversion moment. Don't make it feel like an error.
- Primary CTA ("Create your first quiz") should be centered, prominent, and paired with a one-line benefit statement.
- No other UI competing for attention on first visit.

**Quiz setup:**
- Three fields: title, description (optional), topic tag. That's it.
- Inline validation — don't surface errors until the user has attempted to leave a field.
- "Continue" advances to the builder. Don't call it "Save" — that implies finality.

**Question builder:**
- Each question is a card. Cards stack vertically. The active card is visually elevated (shadow or border) — all others are recessed.
- Answer options are inline within the card. The "+ Add option" affordance appears below the last option and disappears once the max (4) is reached.
- Marking the correct answer uses a radio (single-correct) or checkbox (multi-select) — the affordance itself communicates the mechanic. Don't explain it with a label.
- Optional timer is a collapsed field ("+ Set time limit") — off by default, not hidden.
- Auto-save indicator: a subtle "Saved" timestamp in the header, updated silently. No toast, no spinner.

**Publish flow:**
- "Publish" is the final action. One button. Don't offer a "Save and exit" at this stage — drafts are auto-saved.
- On publish: a modal appears immediately with the share link, a copy button, and optionally a direct share option. This is the peak of the creation experience — make it feel like a launch, not a confirmation dialog.
- Modal dismisses to the dashboard where the new quiz appears in the list with a "Published" badge.

---

### Taking Flow

**Goal:** Zero perceived friction from link open to first question.

**Quiz intro screen:**
- Show: quiz title, creator name, question count, estimated time (calculated from question count + any timers), topic tag.
- If the creator has set timers: surface a brief notice ("This quiz is timed — you'll have X seconds per question"). Don't bury this.
- Sign-in prompt: a banner at the bottom of the intro card, not the top. It should be the last thing they read, not the first. Copy: "Sign in to save your score and appear on the leaderboard." One-tap dismiss — the X is visible, not hidden.
- Primary CTA: "Start Quiz" — large, full-width on mobile.

**Question screen:**
- One question fills the screen. No scroll if avoidable.
- Progress bar at the top (not a fraction — a visual bar). Question number ("3 of 12") below the bar in small text.
- Timer (if set): below the progress bar, above the question. Number + shrinking bar. Changes color as time runs low.
- Answer options: full-width cards, stacked. Large tap target. No checkboxes or radios — the card tap is the selection mechanic.
- After selection: no submit button. Selection is the action. The feedback state fires immediately.

**Feedback overlay:**
- The selected card's state changes: green border + checkmark icon for correct; red border + X icon for incorrect. Correct answer is revealed if wrong.
- A label appears: "Correct!" or "Not quite." in large type. Brief, not verbose.
- Auto-advances after ~2 seconds. A "Next" tap target is available immediately for users who don't want to wait.
- Do not show a full-screen overlay — the feedback happens *on the question screen*. Keep spatial continuity.

---

### Score & Leaderboard Flow

**Goal:** The score reveal is the emotional peak. Design it to feel earned.

**Final score screen:**
- Score animates in. Recommended: circular progress fill that lands on the score percentage, with the number counting up inside.
- Below the animation: "X of Y correct" and total time taken.
- Per-question breakdown: a collapsed accordion below the score. Collapsed by default — don't make the failure list the first thing they see.
- Primary CTA: "View Leaderboard" — prominent, below the score.
- If unauthenticated: an inline card above the CTA. Copy: "Want your score on the leaderboard? Sign in — it only takes a second." This is contextually motivated — they know their score, they want it to count.

**Leaderboard screen:**
- Header: quiz title, total entries.
- Table: rank, username, score %, time taken.
- Current user's row: highlighted with a background tint and bold text. Sticky if they're below the fold.
- Anonymous scores: shown as "Guest" with a dash for username. Visually recessed — not hidden, but clearly second-class. This motivates sign-in without nagging.
- Real-time updates: scores update in place with a subtle flash — no reload, no spinner.
- Footer CTAs: "Play again" (secondary) and "Try another quiz" (tertiary — defer this to v2 if discovery isn't built).

---

## Component Direction

### Question builder card

```
┌─────────────────────────────────────────┐
│ Q3                              [Delete] │
│                                          │
│ [Question text field — large]            │
│                                          │
│ Type: [Multiple choice ▾]                │
│                                          │
│ ○ [Option A field]                       │
│ ○ [Option B field]                       │
│ ○ [Option C field]                       │
│ + Add option                             │
│                                          │
│ + Set time limit                         │
└─────────────────────────────────────────┘
```

- The radio/checkbox to the left of each option *is* the "mark correct" control.
- Active card has elevation. Inactive cards are flat.

### Answer feedback state

```
Before selection:
┌──────────────────────┐
│  A. Option text       │  ← neutral card
└──────────────────────┘

After correct selection:
┌──────────────────────┐
│ ✓ A. Option text      │  ← green border, checkmark
└──────────────────────┘
                         "Correct!"  [auto-advance 2s / tap to continue]

After incorrect selection:
┌──────────────────────┐
│ ✗ A. Option text      │  ← red border, X icon
└──────────────────────┘
┌──────────────────────┐
│ ✓ B. Option text      │  ← green border, reveals correct
└──────────────────────┘
                         "Not quite."  [auto-advance 2s / tap to continue]
```

### Sign-in prompt variants

**Intro screen (dismissible banner):**
> Sign in to save your score and appear on the leaderboard.  [Sign in]  [✕]

**Post-quiz (inline card, unauthenticated):**
> Want your score on the leaderboard? Sign in — it only takes a second.  [Sign in]

Both: non-blocking, benefit-framed, no guilt language.

---

## Responsive Approach

| Surface | Mobile | Desktop |
|---|---|---|
| Quiz taking | Full priority — single column, large targets | Centered single column, max ~600px wide |
| Question builder | Functional but not optimized | Primary surface — full editor layout |
| Leaderboard | Horizontal scroll on table if needed | Full table |
| Dashboard | Creator flow deferred; read-only quiz list OK | Full management UI |

---

## States to Design (All P0 Screens)

Every P0 screen needs:
- Default state
- Loading state (skeleton, not spinner where possible)
- Empty state (where applicable)
- Error state (where applicable)
- Mobile viewport

Additional states:
- Question screen: unanswered / answered-correct / answered-incorrect / timer-critical
- Leaderboard: current user in top 10 / current user outside top 10 / anonymous user / empty (no scores yet)
- Publish modal: copy success confirmation (brief, inline)

---

## What to Avoid

- **Modal stacking.** One modal at a time. No modal-on-modal.
- **Confirmation dialogs for reversible actions.** Deleting a question in the builder should use undo, not a confirm dialog.
- **Passive progress indicators during quiz.** Don't show a spinner between questions — transitions should be instant or near-instant.
- **Punishing feedback language.** "Wrong!" is fine in a game; "Incorrect" is clinical. "Not quite" is human. Decide on a voice and apply it consistently.
- **Leaderboard as an afterthought.** It is a primary screen. It should load fast and feel alive.

---

## Handoff Checklist

Before designs move to engineering:

- [ ] All P0 screens in both mobile and desktop viewports
- [ ] All states documented per screen (default, loading, error, empty)
- [ ] Interaction annotations on: feedback overlay timing, score animation, leaderboard real-time update behavior, auto-save indicator
- [ ] Copy finalized for: sign-in prompts (both placements), empty states (dashboard + leaderboard), error states (quiz not found, quiz expired)
- [ ] Accessibility annotations: focus order, ARIA roles for feedback states, color-independent feedback indicators
- [ ] Component spec exported: question builder card, feedback overlay, score reveal, leaderboard row (including highlighted variant)
```