// electron-builder configuration — used by scripts/build-desktop.mjs
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
    // ad-hoc signature (no paid Apple certificate): required for Apple Silicon to run the app
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    artifactName: 'Lineup-mac-${arch}.${ext}',
  },
  dmg: {
    title: 'Lineup',
    writeUpdateInfo: false,
  },
  win: {
    icon: 'native/icons/app-icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
    // no Windows code-signing certificate; icon and version info are set in after-pack.cjs (no Wine needed)
    signAndEditExecutable: false,
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
