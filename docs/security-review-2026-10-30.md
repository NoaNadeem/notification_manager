# Security and correctness review — 2026-10-30

Reviewed source: `973e39286aa79bae7dbc76934c59d04dd0e5ffcf` in `/Users/nadeem/Documents/notification_manager`.

This is a source review with offline test validation, not a penetration test or a certification. No real Calendar events, Drive records, OAuth credentials, installed applications, or security settings were modified. Application fixes below have **not** been implemented in this review. Another reviewer should independently validate and prioritize them before the coding agent implements fixes.

## Findings

### R1 — P1: exported Android activity can force widget actions to commit without authenticating the navigation request

- Evidence: `app/src/main/AndroidManifest.xml:19` exports `MainActivity`; `MainActivity.kt:187` and `:228` accept any Intent containing `widget_destination` and immediately call `NotificationWidget.commitPendingActions`. `NotificationWidget.kt:297` delegates to `commitWidgetUndo`, which schedules the newest pending action with zero delay (`:145`).
- Trigger: another foreground app explicitly launches this exported activity with a `widget_destination` extra while the user has a widget move/dismissal in its Undo period. The value need not even be a recognized navigation command.
- Impact: an external caller can shorten the user's cancellation window and initiate an already-staged Calendar/Drive mutation. This does **not** demonstrate arbitrary event creation or disclosure, and it requires an existing staged widget action. The secret check on the widget broadcast receiver does not protect this activity entry point.
- Recommended fix: preserve the public launcher but move privileged widget navigation into a non-exported activity/router reachable through explicit immutable PendingIntents, or verify a private capability before accepting widget extras or committing anything. Apply the same validation in `onCreate` and `onNewIntent`; do not trust an extra naming a caller/package.
- Regression: an unauthenticated synthetic incoming Intent must never flush a pending action, open an event, or show an edit picker; legitimate widget PendingIntents must continue working. Use a fake scheduler, not actual event actions.
- Confidence: confirmed source path; not exercised against a real device/account.

### R2 — P2: Android in-flight actions use mutable account/UI state after suspension

- Evidence: `MainActivity.kt:405` uses the action's captured access token and original event, but after the request returns `:420` derives `cacheAccount` from the current `accountName`; `:428–434` writes move history under that account and syncs it using the captured token. Logout (`:942` onward) does not drain or invalidate these jobs. Undo similarly checks account identity before awaiting a job (`:539–547`), not after each suspension.
- Trigger: hold an account A request, disconnect/switch to B, load B, then release A's result.
- Impact: old-account results can update the new session's UI, cache/history, or sync diagnostics. The history operation can combine a B-keyed local history store with A's credential. Whether a remote write succeeds after revocation depends on token validity; local account contamination does not require a successful remote write.
- Recommended fix: capture account identity and connection generation in every staged action/operation, scope all stores and credentials to it, and ignore stale-session UI completions. Define logout behavior for pending/in-flight actions and recheck identity after awaits. Review the extension's global-account callbacks for equivalent races, without assuming the extension is affected identically (its normal logout currently awaits the save queue).
- Regression: deferred mock responses around logout/account switching must never cross account keys, credentials, visible lists, or error state.
- Confidence: confirmed inconsistent state ownership; exploit/remote disclosure not demonstrated.

### R3 — P2: Android main-app actions are not a durable outbox

- Evidence: `MainActivity.kt:399` runs commits in a Compose-owned coroutine scope and retains job handles in memory. `LastUndo.kt:7` persists only the last original event, action kind, and optional completed move; it does not contain the original move target/staging time or all queued actions. The post-save moved snapshot is written only after the Calendar request returns (`MainActivity.kt:405–410`).
- Trigger: multiple rapid actions followed by activity recreation/process termination, or termination after the server applies a move but before its result is recorded locally.
- Impact: earlier unsaved actions cannot be recovered reliably. The last action can also have an unknown outcome; after reopening, a move Undo with no saved destination cannot safely distinguish its own applied move from a later external edit.
- Recommended fix: persist all action intents and destinations before dispatch; use idempotent, account-scoped worker/reconciliation logic; persist compensation intents too. Treat server-committed/local-unknown outcomes explicitly, preserving safe conflict checks.
- Regression: terminate/recreate around persist/request/response/ack boundaries with ten synthetic actions, including offline retries and a response lost after a successful server mutation.
- Confidence: confirmed persistence gap; existing unit tests do not cover process death.

### R4 — P2: delayed Android/widget forward moves can overwrite a newer external reschedule

- Evidence: `NotificationWidget.kt:597` calls `moveCalendarEvent` using a cached event. `CalendarEvents.kt:345` fetches the current server object; the normal forward-move branch computes and PUTs new times without comparing them to the event snapshot the user acted on. The ETag guards only changes between that fresh GET and PUT, not changes made since the original tap. The restore/Undo branch has a time conflict check; the normal branch does not.
- Trigger: stage a delayed/widget move, change that event elsewhere, then allow the queued action to execute.
- Impact: the old queued intention can reschedule an event the user has already moved elsewhere.
- Recommended fix: persist and compare the original expected start/end plus intended destination; recognize an already-applied destination as success and refuse unrelated changes. Mirror the extension's `destination.js` contract, including all-day exclusive ends and recurring-event guards.
- Regression: queued original → external move → retry must produce a conflict and zero PUTs; an already-applied move must not be applied twice.
- Confidence: confirmed missing forward-move precondition.

### R5 — P2: Android widget header Undo still expires and does not share retained last-action Undo

- Evidence: `NotificationWidget.kt:340–345` enables its header arrow with `widgetCanUndo`, which uses the configurable inline deadline. The `undo_latest` receiver path (`:190`) also refuses expired actions. Widget staging/worker paths do not record their last action in `LastUndoStore`.
- Impact: the main app's retained header Undo does not cover widget actions; choosing zero seconds leaves the widget header arrow unavailable. This violates the intended consistent phone behavior if the widget is included, and was missed in the last implementation.
- Recommended fix: explicitly include the widget in the retained Undo design. Share account-scoped reversible-action metadata and serialize Undo against its worker so a still-running save cannot reapply the action after Undo. Do not merely enable the icon or open the app with a stale last action.
- Regression: zero-second widget move/dismiss → worker still running/completed → header Undo; also test reopening and a newer main-app action superseding a widget action.
- Confidence: confirmed behavior divergence.

### R6 — P2: restoration markers are incompatible with older clients that ignore `restored`

- Evidence: current `Dismissals.kt` and extension `model.js` treat a newer record with `restored=true` as visible. The previous code at `3c69d64` does not recognize this field and hides every matching dismissal record. Published Android 1.6/version 7 predates this change; its release version has intentionally not been bumped or published again.
- Trigger: undo a committed dismissal with the updated extension, then refresh an older installed phone app. That client can still hide the event and drop restoration state when parsing/serializing it.
- Recommended fix: define a mixed-version rollout/migration policy and test old/new readers. At minimum ship matching restoration support to phone testers before promising cross-device restoration. Avoid treating optional fields inside an unchanged version as universally backward-compatible semantics.
- Regression: an old/new synthetic client matrix, including local persistence, republishing, equal timestamps, and re-dismiss after restoration.
- Confidence: confirmed old-reader semantics; no live cross-device records were changed.

### R7 — P2: Android backup policy includes sensitive cached metadata and device-local state by default

- Evidence: `AndroidManifest.xml:9` enables backup; `res/xml/backup_rules.xml` and `data_extraction_rules.xml` still contain template comments with no exclusions. Local preferences contain event titles/times/locations, account identifiers, dismissal/move history, retained Undo, and the widget broadcast capability secret.
- Impact: these files are eligible for OS-managed backup/transfer under default rules. This is not a claim that arbitrary apps can read private preferences or that backups are public. Device-local capability/operation metadata can also be restored onto another installation without an explicit reconciliation policy.
- Recommended fix: choose an explicit backup allowlist, keeping benign preferences such as theme/timing if desired while excluding sensitive caches, capability secrets, and non-transferable action state. Review Android-version/device-transfer behavior and restore-time key rotation. Do not just disable all backup without considering user settings.
- Reference: https://developer.android.com/identity/data/autobackup (default coverage and include/exclude rules).
- Regression: inspect effective rules and verify a synthetic backup/restore does not migrate secrets or replay actions.
- Confidence: configuration confirmed; actual cloud backup/device transfer not performed.

## Additional follow-up, not promoted to confirmed security defects

- Extension reverse actions are not separate durable outbox operations: `window.js:638` removes the forward outbox record before the inverse request. Retained last-action metadata permits manual retry while it remains latest, but review interruption/new-action behavior before claiming automatic durable Undo recovery.
- Queue serialization in `PendingActionStore` is per object/page. Review duplicate extension pages and concurrent processes before assuming it is a cross-window lock.
- Review malformed/oversized Drive marker handling, clock skew, timestamp ordering, and equal-timestamp restoration/re-dismiss behavior. These inputs originate in the user's app-data space, not an unauthenticated public endpoint.
- Dependency versions were inventoried, but no vulnerability feed/SBOM scan was completed. An old-looking version alone is not evidence of a vulnerability.

## Controls observed and verification

- Calendar/Drive API URLs are constructed on Google endpoints; normal move requests use `If-Match` and suppress attendee notifications. Recurring-event move guards exist in both clients.
- Event title/editor links have explicit Google host/HTTPS validation; location links are restricted to web URLs or a constructed Maps search. The extension uses text nodes rather than event-title HTML injection.
- Widget broadcast actions check a private capability secret. That control should be preserved, but it does not cover R1's activity path.
- The retained Android Undo record contains no OAuth token. Public OAuth client IDs and the extension manifest's public signing key are not secrets.
- No tracked signing-key/credential filenames were found by a focused filename inventory. This is not a full secret-history audit; no private files or credential contents were read.
- Existing offline checks: **87 Chrome extension tests pass; Android unit checks pass (53 tests at the reviewed source)**. These do not prove the missing lifecycle, account-transition, mixed-version, or exported-component cases safe.

No product code changed during this review. Review documents and the independent-review prompt are the only requested edits. No Android release was prepared; no extension reload is needed for documentation-only changes.
