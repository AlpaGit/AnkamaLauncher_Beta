module.exports = {
  settings: {},
  buildConfig: {},
  window: {
    isFocused: true,
    isMaximized: false,
    isFullscreen: false,
  },
  autoUpdater: {
    downloadProgress: null,
    isReady: false,
    isUpdating: false,
  },
  games: {},
  display: {
    releaseView: {
      gameUid: null,
      name: null,
    },
    showReleaseInstallPopup: false,
    showReleaseUninstallPopup: false,
    showReleaseSettingsPopup: false,
    showZaapSettingsPopup: false,
    news: {},
  },
  auth: {
    isAuthenticated: false,
  },
  user: {
    isLoading: false,
  },
  terms: {
    content: {},
    needsToAcceptNewVersion: false,
  },
  connectivity: {
    isOnline: true,
  },
}
