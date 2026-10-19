# RideShare Android app

A thin Android wrapper (Capacitor) around the live RideShare website, plus a native **background location helper** so a driver's position keeps reaching their riders while Google Maps is on screen giving voice directions.

- The app loads `https://juliaonmoon.github.io/rideshare/prototype/` (so web updates reach the app automatically). See `capacitor.config.json`.
- `android/app/src/main/java/ca/rideshare/app/`
  - `LocationService.java`: foreground service (Android shows a permanent "RideShare is sharing your location" notification), reads GPS every ~4 s and posts to `rpc/share_position_token`. Stops by itself when the server says "No ride in progress" or the token is invalid.
  - `RideShareLocationPlugin.java`: the bridge the web page calls: `start({url,key,token})`, `stop()`, `status()`, `openUrl({url})` (opens Google Maps).
- The web page (`prototype/live.js`) asks the database for a 12-hour tracking token (`start_tracking()`, migration 008), starts the helper, then opens Google Maps with navigation already started.

## Build a test APK (Windows)
Needs Java 21 (not 25), the Android SDK, Node.
```
cd android-app
npm install
set JAVA_HOME=C:\Users\jules\jdk21
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
cd android && gradlew assembleDebug
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Install on a phone with USB debugging: `adb install -r app-debug.apk`.
The debug build allows plain http and WebView debugging (for tests). Release builds must be signed with a keystore kept OUTSIDE the repo, with WebView debugging off.

## Tested on a virtual Android 15 phone
Helper starts, keeps sending while RideShare is in the background, shows its notification, stops by itself on "No ride in progress", and can be stopped and restarted. Not yet tested on a real phone.

## Limits
- Android only. iPhone drivers cannot track in the background (use the website).
- Needs migration 008 in Supabase before the helper can get a token.
