# Android Build Fix Guide

## Issues Fixed

The Android APK was crashing on startup due to several platform-specific issues:

### 1. Linux-specific `nmcli` Command
**Problem:** The `get_current_connection()` function was calling `nmcli` (NetworkManager CLI), which only exists on Linux desktop systems and is not available on Android.

**Fix:** Added platform-specific compilation directives:
- On Android: Returns `None` to gracefully disable WiFi network detection
- On other platforms: Uses `nmcli` as before

### 2. Database Path Handling
**Problem:** The database path initialization didn't handle Android's app storage properly.

**Fix:** Enhanced `get_db_path()` with Android-specific path handling and fallback logic.

### 3. Missing Android Configuration
**Problem:** Missing Android-specific configuration in `tauri.conf.json`.

**Fix:** Added:
- `withGlobalTauri: true` for proper Android initialization
- `minSdkVersion: 24` for Android compatibility

## Android Permissions Required

The app requires these Android permissions (to be added to AndroidManifest.xml after initialization):

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

These are automatically handled by the Tauri geolocation plugin, but may need verification.

## How to Build for Android

### Prerequisites
1. Install Android Studio and Android SDK
2. Set up environment variables:
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk
   export NDK_HOME=$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk)
   ```

### Initialize Android Project
```bash
npm run tauri android init
```

This will:
- Create the Android project structure
- Generate AndroidManifest.xml
- Set up Gradle build files

### Add Android Targets (if not already installed)
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### Build APK
```bash
# Development build
npm run tauri android dev

# Production build
npm run tauri android build
```

### Optional: Manual AndroidManifest Verification
After initialization, verify that these permissions are in `src-tauri/gen/android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

## Known Limitations on Android

- **WiFi Network Detection:** Currently disabled on Android. The app won't automatically detect which WiFi network you're connected to. This feature would require implementing Android-specific WiFi APIs using a Java/Kotlin bridge.
- **Network-based Stop Pinning:** Features that rely on automatic network detection won't work on Android.

## Testing

After rebuilding with the fixes:
1. Install the APK on your Android device
2. The app should now start without crashing
3. Core features (stop search, departures, geolocation) should work
4. Network-based features will be disabled

## Future Enhancements

To re-enable network detection on Android, you would need to:
1. Create a Kotlin/Java plugin that uses `WifiManager` and `ConnectivityManager`
2. Bridge it to the Rust code using Tauri's mobile plugin system
3. Request `ACCESS_WIFI_STATE` permission
