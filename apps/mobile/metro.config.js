// Конфигурация Metro по умолчанию. Expo сам определяет monorepo (npm workspaces)
// и находит пакет @sozhiteli/api-client; дополнительных настроек не требуется.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
