# Notification Manager

Android companion for past events on the signed-in account's primary Google Calendar.

## Build and share a test APK

Build on the same Mac used for the current phone install so the APK keeps the same Android debug signing certificate:

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

The installable APK is `app/build/outputs/apk/debug/app-debug.apk`. To publish a shareable GitHub prerelease, choose a new tag and matching asset name for each build:

```sh
mkdir -p dist
cp app/build/outputs/apk/debug/app-debug.apk dist/notification-manager-v0.1.0-test.apk
gh release create v0.1.0-test dist/notification-manager-v0.1.0-test.apk \
  --target main --title "Notification Manager v0.1.0 test" \
  --notes "Android test build" --prerelease
```

The direct APK URL follows this form:

```text
https://github.com/NoaNadeem/notification_manager/releases/download/v0.1.0-test/notification-manager-v0.1.0-test.apk
```

Send that URL to the tester. They can download the APK on their Android phone, open it, and allow installation from their browser or file manager if Android prompts them. The GitHub repository is public, so release assets are public too. Put APKs in GitHub Releases rather than committing them to Git; `dist/` is ignored.

For Google sign-in while the OAuth app is in Testing mode, add the tester's Google account under **Google Auth platform → Audience → Test users** in Cloud project `411250810503`. The app's Android OAuth client is tied to its package name and the APK signing certificate's SHA-1. A build made on another computer or a GitHub Actions runner can have a different debug certificate and require another Android OAuth client. Keep using the same signing key for test updates. A production release should use a dedicated release signing key.
