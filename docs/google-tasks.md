# Google Tasks support

Google Tasks are displayed with Calendar events in the Android main app, home-screen widget, and Chrome extension. All task lists are read with pagination, including assigned tasks exposed by the API; completed, deleted, and hidden tasks are excluded. Dated tasks use the same review window as events. Undated tasks remain visible at the end as “No due date.” Task and event IDs are namespaced to prevent collisions, including identical task IDs in different lists.

## Actions and Undo

Day moves and the date picker update only the Google Task's date. Hour moves and time selection are unavailable: Google Tasks does not expose time-of-day through its API. Pencil/title opens Google's task UI using the returned web link; no unsupported editor route is invented. For undated tasks, date moves assign a date and Undo can remove it again.

Dismissing a task **marks it completed in Google Tasks**. Header Undo reopens it as incomplete. Local dismissal records remain history, but they do not override Google Tasks' active/completed state: reopening a task in Google's own UI makes it visible here again. Event dismissal is unchanged and remains specific to Notification Manager.

Task moves use a fresh server read, ETag, and original-date comparison; retries recognize an already-applied date and refuse unrelated changes. Updates patch only `due` or `status`/`completed`, preserving the title, notes, and other fields. No task delete/create operation is implemented.

The Tasks API does not expose recurrence configuration. This app cannot manage recurrence rules or guarantee reversal of any additional task occurrence Google itself generates when completing a recurring task. Assigned-task restrictions are enforced by Google; errors are surfaced rather than silently changing another object.

## Description line

The first nonblank line of task notes appears below the title using the event-location text style. A web URL in that line is clickable; plain text remains plain text (it is not sent to Maps). HTML/JavaScript in notes is rendered as text, never executed. Tasks assigned from Docs can lack notes entirely.

## Setup

Google Tasks API was enabled for this project during Android 1.7 publication on October 31, 2026. Users still need to authorize Tasks access.

1. Enable **Google Tasks API** in Cloud project `notification-manager-509623`: https://console.cloud.google.com/apis/library/tasks.googleapis.com?project=notification-manager-509623
2. Add/allow the OAuth scope `https://www.googleapis.com/auth/tasks` in the project's Google Auth Platform configuration if required by its current consent setup. Google exposes read-only access or full task management, not a narrower move/complete-only scope.
3. Reload the updated extension and reconnect its Google account to grant Tasks access. The extension adds the `tasks.googleapis.com` API host permission.
4. Install the next explicitly requested Android release and reconnect there as well. This feature's code changes do not automatically publish a phone release.

Task-loading errors leave Calendar events available and explain the missing Tasks access/API setup. App and extension preferences remain independent. No live Tasks were modified during implementation/testing.

## List performance

Android already uses `LazyColumn`; the widget uses its scrolling collection adapter. The extension initially renders 100 matching items and reveals another 100 as the bottom approaches, with a “Show next 100” fallback. This is UI batching, independent of reading every Google API page for correct inclusion and sorting. Search results are also rendered in batches. No numbered page navigation is required, and local actions retain the current scroll position.

## Verification

Use synthetic Tasks and mocked requests. Verify list/task pagination, no-date handling, timezone/date math, safe note URLs, same IDs in different task lists, date-only API patches, completion/reopening, ETags, stale-date refusal, and existing event behavior. Never test move/complete/reopen/dismiss against the user's actual task lists.

Sources:
- https://developers.google.com/workspace/tasks/reference/rest/v1/tasks
- https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list
- https://developers.google.com/workspace/tasks/auth


## Permission recovery (Android 1.8 / extension 0.3.24)

A missing Google authorization resolution is offered automatically once when the Android app is foregrounded. An explicit Refresh or Reconnect Google access can offer consent again; cancelling does not repeatedly reopen it. Background widget workers never launch consent UI themselves; opening the app handles it. Tasks scope grants are checked before calling Tasks, and the first Tasks refresh is not skipped merely because a Calendar cache is fresh.

The extension recognizes missing-authorization errors separately from network/quota/API-disabled errors, offers interactive reconnection once while visible, and retries consent on an explicit Refresh or Reconnect action. Reconnection clears stale cached tokens without revoking the account or deleting local state. Sync details stay available before a successful refresh. A Tasks error is stored separately so successful Drive sync cannot erase it.

No real account permission dialogs were accepted during automated verification; permission-required, cancellation, and retry were exercised with synthetic clients and offline tests.
