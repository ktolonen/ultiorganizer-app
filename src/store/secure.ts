import * as SecureStore from 'expo-secure-store';

/**
 * Tokens live only in the Keychain/Keystore. SecureStore keys allow letters,
 * digits, `.`, `-` and `_`, so server and game ids are used, never URLs.
 */
const appKey = (serverId: number) => `app-token.${serverId}`;
const linkKey = (serverId: number, gameId: number) => `link-token.${serverId}.${gameId}`;
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const saveAppToken = (serverId: number, token: string) =>
  SecureStore.setItemAsync(appKey(serverId), token, options);
export const getAppToken = (serverId: number) =>
  SecureStore.getItemAsync(appKey(serverId), options);
export const deleteAppToken = (serverId: number) =>
  SecureStore.deleteItemAsync(appKey(serverId), options);

export const saveLinkToken = (serverId: number, gameId: number, token: string) =>
  SecureStore.setItemAsync(linkKey(serverId, gameId), token, options);
export const getLinkToken = (serverId: number, gameId: number) =>
  SecureStore.getItemAsync(linkKey(serverId, gameId), options);
export const deleteLinkToken = (serverId: number, gameId: number) =>
  SecureStore.deleteItemAsync(linkKey(serverId, gameId), options);
