# Android Build Fix Guide

## Issues Fixed

The Android APK was crashing on startup due to platform-specific issues:

### 1. Database Path Initialization (Root Cause)
**Problem:** The app used `dirs::data_local_dir()` to get the database path, which returns `None` on Android. This caused the database to be created at `.` (current directory), which Android apps cannot write to.

**Fix:** Changed to use Tauri's `app.path().app_data_dir()` which correctly returns the app-specific storage directory on all platforms including Android. The database is now initialized in the `setup` hook after Tauri starts.

### 2. Linux-specific `nmcli` Command  
**Problem:** The `get_current_connection()` function called `nmcli` (NetworkManager CLI), which only exists on Linux desktop systems.

**Fix:** Added `#[cfg(target_os = "android")]` conditional compilation to return `None` on Android, disabling WiFi network detection gracefully.

### 3. Removed Unnecessary Dependency
**Change:** Removed the `dirs` crate dependency since we now use Tauri's built-in path resolution.

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

### Add Android Targets
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

## Known Limitations on Android

- **WiFi Network Detection:** Disabled on Android. The app won't automatically detect which WiFi network you're connected to.
- **Network-based Stop Pinning:** Features that rely on automatic network detection won't work on Android.

## Testing

After rebuilding:
1. Install the APK on your Android device
2. The app should now start without crashing
3. Core features (stop search, departures, geolocation) should work
4. Network-based features will be disabled
