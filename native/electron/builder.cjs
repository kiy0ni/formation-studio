// electron-builder configuration — used by scripts/build-desktop.mjs
const APPLE = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
const AZURE = Boolean(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_SIGN_ENDPOINT);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.kiy0ni.formationstudio',
  productName: 'Lineup',
  copyright: 'Lineup',
  directories: {
    app: 'native/electron/app',
    output: 'native/electron/out',
    buildResources: 'native/icons',
  },
  asar: true,
  // the web app is already bundled: ship only main.js + web/, never the project's node_modules
  files: ['main.js', 'package.json', 'web/**/*', '!node_modules{,/**/*}'],
  npmRebuild: false,
  mac: {
    category: 'public.app-category.music',
    icon: 'native/icons/app-icon.png',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    // With an Apple Developer account (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID in the environment and a
    // "Developer ID Application" certificate in the keychain): signed and notarized, no warning on install.
    // Without: ad-hoc signature, required for Apple Silicon to run the app; macOS asks to "open anyway" once.
    ...(APPLE
      ? { hardenedRuntime: true, gatekeeperAssess: false, notarize: true }
      : { identity: '-', hardenedRuntime: false, gatekeeperAssess: false, notarize: false }),
    artifactName: 'Lineup-mac-${arch}.${ext}',
  },
  dmg: {
    title: 'Lineup',
    writeUpdateInfo: false,
  },
  win: {
    icon: 'native/icons/app-icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
    // With Azure Artifact Signing (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SIGN_ENDPOINT,
    // AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE): signed on a Windows machine (see .github/workflows/release.yml).
    // Without: unsigned; icon and version info are set in after-pack.cjs (no Wine needed).
    ...(AZURE
      ? { azureSignOptions: { endpoint: process.env.AZURE_SIGN_ENDPOINT, codeSigningAccountName: process.env.AZURE_SIGN_ACCOUNT, certificateProfileName: process.env.AZURE_SIGN_PROFILE } }
      : { signAndEditExecutable: false }),
    artifactName: 'Lineup-windows.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Lineup',
    installerLanguages: ['fr_FR'],
    language: '1036',
    unicode: true,
  },
  afterPack: 'native/electron/after-pack.cjs',
  publish: null,
};
