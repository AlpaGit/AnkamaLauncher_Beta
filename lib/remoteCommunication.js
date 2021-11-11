/**
 * Module which manage all IPC channels and sends to all windows
 *
 * @module zaap/remoteCommunication
 */
const inject = require('instill')

inject(exports, {
  electron: require('electron'),
})

exports.CHANNELS = {
  AUTH_GET: 'auth.get',
  AUTH_UPDATED: 'auth.updated',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_ERROR: 'auth.login.error',
  AUTH_LOGOUT: 'auth.logout',
  BUILD_CONFIG_GET: 'buildConfig.get',
  GAME_LIST: 'game.list',
  GAME_ADDED: 'game.added',
  GAME_UPDATED: 'game.updated',
  GAME_REMOVED: 'game.removed',
  GO_ANKAMA_GET_URL: 'goAnkama.getUrl',
  LOGGER_GET_LOGS_PATH: 'logger.path',
  RELEASE_GET_LOGS_PATH: 'release.logs.path',
  RELEASE_GET_INSTALL_INFORMATION: 'release.getInstallInformation',
  RELEASE_GET_FOLDER_SIZE: 'release.getFolderSize',
  RELEASE_GET_LICENSES: 'release.getLicences',
  RELEASE_UPDATE_PAUSE: 'release.update.pause',
  RELEASE_UPDATE_RESUME: 'release.update.resume',
  RELEASE_UPDATE_UPDATED: 'release.update.updated',
  RELEASE_UPDATE_SET_QUEUE_INDEX: 'release.update.setQueueIndex',
  RELEASE_SETTINGS_UPDATE: 'release.settings.update',
  RELEASE_GET_DEFAULT: 'release.get.default',
  RELEASE_WAS_LAUNCHED: 'release.wasLaunched',
  RELEASE_INSTALL: 'release.install',
  RELEASE_INSTALL_ERROR: 'release.install.error',
  RELEASE_INSTALL_STARTED: 'release.install.started',
  RELEASE_MOVE: 'release.move',
  RELEASE_MOVE_ERROR: 'release.move.error',
  RELEASE_MOVE_SUCCESS: 'release.move.success',
  RELEASE_UNINSTALL: 'release.uninstall',
  RELEASE_UNINSTALL_DONE: 'release.uninstall.done',
  RELEASE_UNINSTALL_ERROR: 'release.uninstall.error',
  RELEASE_UPDATE: 'release.update',
  RELEASE_UPDATE_ERROR: 'release.update.error',
  RELEASE_REPAIR: 'release.repair',
  RELEASE_REPAIR_ERROR: 'release.repair.error',
  RELEASE_START: 'release.start',
  RELEASE_START_ERROR: 'release.start.error',
  RELEASE_NEWS_REFRESH: 'release.news.refresh',
  RELEASE_NEWS_REFRESHED: 'release.news.refreshed',
  NEWS_REFRESH: 'news.refresh',
  NEWS_REFRESHED: 'news.refreshed',
  RELEASE_NEWS_CLICK: 'release.news.click',
  TERMS_GET: 'terms.get',
  TERMS_ACCEPT: 'terms.accept',
  TERMS_REFUSE: 'terms.refuse',
  TERMS_NEEDS_TO_ACCEPT_NEW_VERSION: 'terms.needsToAcceptNewVersion',
  ZAAP_SETTINGS_OPEN: 'zaap.settings.open',
  ZAAP_SETTINGS_GET: 'zaap.settings.get',
  ZAAP_SETTINGS_SET: 'zaap.settings.set',
  ZAAP_SETTINGS_UPDATED: 'zaap.settings.updated',
  ZAAP_AUTO_UPDATER_CHECK: 'zaap.autoUpdater.check',
  ZAAP_AUTO_UPDATER_PROGRESS: 'zaap.autoUpdater.progress',
  ZAAP_AUTO_UPDATER_READY: 'zaap.autoUpdater.ready',
  ZAAP_AUTO_UPDATER_INSTALL: 'zaap.autoUpdater.install',
  ZAAP_QUIT: 'zaap.quit',
  SPAWN_SCRIPT: 'spawnScript',
  SPAWN_SCRIPT_RESULT: 'spawnScript.result',
  CONNECTIVITY_GET: 'zaap.connectivity.get',
  CONNECTIVITY_UPDATED: 'zaap.connectivity.updated',
  USER_SET_NICKNAME: 'user.set.nickname',
  USER_NICKNAME_ERROR: 'user.nickname.error',
  USER_RELEASE_READY: 'user.release.ready',
  WINDOW_IS_FOCUSED: 'window.isFocused',
  WINDOW_IS_MAXIMIZED: 'window.isMaximized',
  WINDOW_IS_FULLSCREEN: 'window.isFullscreen',
  MAIN_WINDOW_READY: 'windows.main.ready',
  MAIN_WINDOW_FULLY_LOADED: 'windows.main.fullyLoaded',
  MAIN_PROCESS_READY: 'mainProcess.ready',
  IS_MAIN_PROCESS_READY: 'is.mainProcess.ready',
}

exports.send = function (channel, ...args) {
  const {
    electron,
  } = this.modules

  const windows = electron.app.windows
  Object.keys(windows).forEach(function (key) {
    const activeWindow = windows[key].activeWindow
    if (activeWindow) {
      activeWindow.webContents.send(channel, ...args)
    }
  }, this)
}

