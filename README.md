# Notification Manager

Android companion for past events on the signed-in account's primary Google Calendar.

Pull down from the top of the event list to refresh Calendar events and Drive dismissals.

The Chrome desktop companion lives in [chrome-extension](chrome-extension/README.md). It opens a dedicated manager window when Chrome starts; its one-time Google OAuth and unpacked-install steps are in that README.

## Install development updates over Wi-Fi

The connected Samsung runs Android 16, so it supports Android's paired Wireless debugging. Pair it once while the Mac and phone are on the same Wi-Fi network:

1. On the phone, open **Settings → Developer options → Wireless debugging**. Turn it on, allow the current Wi-Fi network, then tap **Pair device with pairing code**.
2. In Android Studio, choose **Pair Devices Using Wi-Fi** from the device selector (or Device Manager), select **Pair using pairing code**, and enter the six-digit code shown on the phone.
3. Unplug the USB cable and check that the phone appears in Android Studio's device selector. If it does not, use the IP address and port on the phone's main **Wireless debugging** screen with `~/Library/Android/sdk/platform-tools/adb connect IP:PORT` (this is different from the temporary pairing port).

After pairing, a development update from this Mac is `./gradlew :app:assembleDebug` followed by `~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk`, or press **Run** in Android Studio with the wireless device selected. The `-r` install retains app data. This only deploys from the Mac; pushing Git code alone does not install an update. Keep Wireless debugging enabled and both devices on the same network for wireless installs. The pairing survives unplugging the cable. See [Android's wireless debugging guide](https://developer.android.com/studio/run/device#connect).

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
