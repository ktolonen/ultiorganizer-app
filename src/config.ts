import Constants from 'expo-constants';

/** True only in development builds (APP_VARIANT=development), which may use http on local addresses. */
export const ALLOW_DEV_HTTP = Constants.expoConfig?.extra?.devHttp === true;
export const QR_OPTIONS = { allowDevHttp: ALLOW_DEV_HTTP } as const;
