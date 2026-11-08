import type { ConfigContext, ExpoConfig } from 'expo/config';

// Cleartext http is allowed only in development builds (APP_VARIANT=development),
// for a dev stack on the LAN or the Android emulator. Release builds are https only.
const isDev = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDev ? 'Ultiorganizer Scorekeeper (dev)' : 'Ultiorganizer Scorekeeper',
  slug: 'ultiorganizer-field',
  owner: 'ultiorganizer-team',
  version: '0.1.0',
  orientation: 'default',
  icon: './assets/images/icon.png',
  // Not `ultiorganizer-app`: the setup QR is read by the in-app scanner only, and
  // Android does not verify custom schemes, so another app could claim it.
  scheme: 'ultiorganizer-field',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: isDev ? 'org.ultiorganizer.field.dev' : 'org.ultiorganizer.field',
    supportsTablet: true,
    // Only standard https (exempt), so TestFlight skips the export compliance prompt.
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSCameraUsageDescription: 'The camera scans the scorekeeping and setup QR codes.',
      ...(isDev ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
    },
  },
  android: {
    package: isDev ? 'org.ultiorganizer.field.dev' : 'org.ultiorganizer.field',
    adaptiveIcon: {
      backgroundColor: '#0050C8',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    'expo-localization',
    ['expo-camera', { cameraPermission: 'The camera scans the scorekeeping and setup QR codes.' }],
    ['expo-notifications', { enableBackgroundRemoteNotifications: false }],
    ['expo-build-properties', { android: { usesCleartextTraffic: isDev } }],
  ],
  // OTA updates: a build only takes updates published for its own app version.
  runtimeVersion: { policy: 'appVersion' },
  updates: { url: 'https://u.expo.dev/e0f56510-4595-4388-860e-fe6f32be9101' },
  extra: { devHttp: isDev, eas: { projectId: 'e0f56510-4595-4388-860e-fe6f32be9101' } },
  experiments: { reactCompiler: true },
});
