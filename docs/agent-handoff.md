# Notification Manager: independent security and correctness review

Use the current checkout at `/Users/nadeem/Documents/notification_manager`. Older handoff paths under `adobe/go/src` are obsolete.

The complete copy-and-paste instruction for a reviewer is [agent-review-note.txt](agent-review-note.txt). It requests **read-only feedback, not code changes**; the primary coding agent will implement accepted fixes.

Start with [AGENTS.md](../AGENTS.md), [the dated review](security-review-2026-10-30.md), [the extension README](../chrome-extension/README.md), and the source map in the reviewer note. The dated review anchors findings to source commit `973e392`; reviewers must record the current commit and re-check line numbers.

## Safety

The Google account contains real personal Calendar events. Never change or stage an action on those events, call Calendar/Drive write APIs, or use live controls for testing. Use pure tests, mocked APIs, and isolated synthetic events with networking disabled. Do not read or print access tokens, signing keys, passwords, or private event/account data. Do not deploy, reload live event pages, install builds, or publish a phone release as part of this review.

## Current behavior

- Inline event Undo defaults to 2 seconds; menu values are whole numbers 0–30. Zero starts background saving immediately.
- Header Undo retains the last action independently, including after reopening; reversing a saved move must preserve exact original times without overwriting a later external edit. Dismissal restoration is synced as a newer marker.
- App and extension preferences remain independent local settings.
- The extension shows one centered action row on event hover/focus: Dismiss, Pencil, Calendar, 4H, 7D, 3D, 2D, 1D. Titles clamp to three lines. Undo remains visible; touch actions remain accessible.
- Successful moves return chronologically if still in range; no automatic scrolling or Saved placeholder.
- The Android widget has its own worker/Undo paths and needs explicit consistency review; do not assume main-app fixes automatically cover it.
- Android 1.9/version 10 was published to internal testing on October 31, 2026, including normal Task backgrounds and single-row app/widget Task menus, plus Tasks and retained main-app Undo. Older installed clients can remain on 1.6; mixed-version marker compatibility still matters.

Google Tasks code is in `GoogleTasks.kt` and `chrome-extension/tasks.js`; read [Tasks behavior and setup](google-tasks.md). Task dismissal completes the Google Task and Undo reopens it; Task dates cannot expose time-of-day. The extension renders 100 more items as you scroll; Android retains its lazy list. This feature was added after the dated security review and needs independent review too.

The main focus is exported-component trust, OAuth/account isolation, race/lifecycle safety, durable writes and compensations, marker compatibility, and backup/privacy boundaries. Return prioritized findings with concrete triggers, exact file/line evidence, proposed fixes, and synthetic regression tests. Validate earlier findings independently.

The 1.8 permission recovery paths are in `AuthorizationFlow.kt`, `MainActivity.kt`, `chrome-extension/authorization.js`, and `window.js`. Review once-per-session prompting, foreground-only launch, cancellation and explicit retry, partial grants, and independent Tasks error persistence. Current checks: 59 Android tests and 97 extension tests.
