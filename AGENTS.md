# Notification Manager workflow

For future changes to Notification Manager:
- Use the existing checkout at `/Users/nadeem/Documents/notification_manager` and sync the latest GitHub changes before editing.
- After fixing code, run the relevant checks, reload the installed unpacked extension at `chrome://extensions`, and verify the updated UI. Do not leave deployment for the user to do manually.
- Commit and push completed changes to `https://github.com/NoaNadeem/notification_manager` so they are backed up.
- Only prepare or publish a phone-app release when explicitly requested. Ordinary fixes may be compiled and tested, but must not bump the Android release version or regenerate a signed release bundle automatically.
- Report any permission or deployment blocker clearly; do not claim a reload or push succeeded without verification.

## Real calendar data: read-only during agent work

- Never perform write actions on the user's actual calendar events. The connected test account contains real personal events; calling it a test account does not authorize modifying them.
- Do not click move, reschedule, dismiss, delete, edit/save, or other event-changing controls on real events, including actions that first enter an Undo period or later commit on blur, navigation, timeout, or reload. Do not call Calendar or dismissal-sync write APIs against those events.
- Verify behavior with local fixtures, mocks, or isolated synthetic data. Read-only inspection and UI checks that cannot stage or commit an event change are allowed.
