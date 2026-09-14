import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kiy0ni.formationstudio',
  appName: 'Formation Studio',
  webDir: 'dist',
  backgroundColor: '#0c0c10',
  plugins: {
    // dark app: light status / navigation bar icons, content drawn edge to edge with safe-area padding
    SystemBars: { style: 'DARK', insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
  ios: {
    backgroundColor: '#0c0c10',
    contentInset: 'never',
    webContentsDebuggingEnabled: process.env.FS_DEBUG === '1',
  },
  android: {
    backgroundColor: '#0c0c10',
    // enable only for local testing builds (FS_DEBUG=1)
    webContentsDebuggingEnabled: process.env.FS_DEBUG === '1',
  },
};

export default config;
