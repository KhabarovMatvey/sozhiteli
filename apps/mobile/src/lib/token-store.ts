/**
 * Хранение refresh token между запусками приложения.
 *
 * На Android и iOS - защищённое хранилище устройства (Keychain / Keystore).
 * В веб-режиме Expo защищённого хранилища нет, поэтому токен живёт только в
 * памяти вкладки: после перезагрузки страницы нужно войти снова. Это
 * осознанно - хранить токен в localStorage небезопасно (README.md, раздел «Безопасность»).
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'sozhiteli.refresh_token';
const persistent = Platform.OS !== 'web';

let memory: string | null = null;

export async function readRefreshToken(): Promise<string | null> {
  return persistent ? SecureStore.getItemAsync(KEY) : memory;
}

export async function saveRefreshToken(token: string | null): Promise<void> {
  if (!persistent) {
    memory = token;
    return;
  }
  if (token) await SecureStore.setItemAsync(KEY, token);
  else await SecureStore.deleteItemAsync(KEY);
}
