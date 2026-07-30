const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

// Монорепо: @family-messenger/crypto лежит вне app/ (../packages/crypto) и
// подключён как file:-зависимость. Metro по умолчанию следит только за
// projectRoot, поэтому корень репозитория нужно добавить явно, иначе бандл
// не соберётся ("Unable to resolve @family-messenger/crypto").
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
