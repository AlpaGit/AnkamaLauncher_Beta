const types = require('./types')

function getGameFromState(state, gameUid) {
  return state.games[gameUid]
}

function getReleaseFromState(state, gameUid, releaseName) {
  const game = getGameFromState(state, gameUid)
  return game.releases[releaseName]
}

exports[types.SET_SETTINGS] = function (state, settings) {
  Vue.set(state, 'settings', settings)
  Vue.set(state, 'settingsSynchronized', true)
}

exports[types.SET_BUILD_CONFIG] = function (state, buildConfig) {
  Vue.set(state, 'buildConfig', buildConfig)
}

exports[types.SET_WINDOW_IS_FOCUSED] = function (state, windowIsFocused) {
  Vue.set(state.window, 'isFocused', windowIsFocused)
}

exports[types.SET_WINDOW_IS_MAXIMIZED] = function (state, windowIsMaximized) {
  Vue.set(state.window, 'isMaximized', windowIsMaximized)
}

exports[types.SET_WINDOW_IS_FULLSCREEN] = function (state, windowIsFullscreen) {
  Vue.set(state.window, 'isFullscreen', windowIsFullscreen)
}

exports[types.SET_ZAAP_AUTO_UPDATER_PROGRESS] = function (state, downloadProgress) {
  Vue.set(state.autoUpdater, 'downloadProgress', downloadProgress)
  Vue.set(state.autoUpdater, 'isUpdating', true)
}
exports[types.SET_ZAAP_AUTO_UPDATER_READY] = function (state) {
  Vue.set(state.autoUpdater, 'isReady', true)
  Vue.set(state.autoUpdater, 'isUpdating', true)
}

exports[types.RESET_GAMES] = function (state, games) {
  const uids = Object.keys(state.games)
  uids.forEach(function (uid) {
    if (!games[uid]) {
      delete state.games[uid]
    }
  })
}

exports[types.SET_GAME] = function (state, game) {
  Vue.set(state.games, game.uid, game)
}

exports[types.REMOVE_GAME] = function (state, game) {
  Vue.delete(state.games, game.uid)
}

exports[types.SET_RELEASE_INFORMATION] = function (state, {
  release,
  information,
}) {
  release = getReleaseFromState(state, release.gameUid, release.name)
  Vue.set(release, 'information', information)
}

exports[types.SET_RELEASE_CONFIGURATION] = function (state, {
  release,
  configuration,
}) {
  release = getReleaseFromState(state, release.gameUid, release.name)
  Vue.set(release, 'configuration', configuration)
}

exports[types.SET_RELEASE_SETTINGS] = function (state, {
  release,
  settings,
}) {
  release = getReleaseFromState(state, release.gameUid, release.name)
  Vue.set(release, 'settings', settings)
}

exports[types.SET_RELEASE_CURRENT_UPDATE] = function (state, {
  gameUid,
  releaseName,
  update,
}) {
  const release = getReleaseFromState(state, gameUid, releaseName)
  Vue.set(release, 'currentUpdate', update)
}

exports[types.SET_RELEASE_NEWS] = function (state, {
  gameUid,
  releaseName,
  news,
}) {
  const release = getReleaseFromState(state, gameUid, releaseName)
  release.news = news
}

exports[types.SET_ALL_NEWS] = function (state, {
  news,
}) {
  state.display.news = news
}

exports[types.DISPLAY_RELEASE] = function (state, release) {
  state.display.releaseView = release
}

exports[types.OPEN_RELEASE_SETTINGS_POPUP] = function (state) {
  state.display.showReleaseSettingsPopup = true
}

exports[types.CLOSE_RELEASE_SETTINGS_POPUP] = function (state) {
  state.display.showReleaseSettingsPopup = false
}

exports[types.OPEN_RELEASE_INSTALL_POPUP] = function (state) {
  state.display.showReleaseInstallPopup = true
}

exports[types.CLOSE_RELEASE_INSTALL_POPUP] = function (state) {
  state.display.showReleaseInstallPopup = false
}

exports[types.OPEN_RELEASE_UNINSTALL_POPUP] = function (state) {
  state.display.showReleaseUninstallPopup = true
}

exports[types.CLOSE_RELEASE_UNINSTALL_POPUP] = function (state) {
  state.display.showReleaseUninstallPopup = false
}

exports[types.OPEN_ZAAP_SETTINGS_POPUP] = function (state) {
  state.display.showZaapSettingsPopup = true
}

exports[types.CLOSE_ZAAP_SETTINGS_POPUP] = function (state) {
  state.display.showZaapSettingsPopup = false
}

exports[types.SET_AUTHENTICATED] = function (state, isAuthenticated) {
  state.auth.isAuthenticated = isAuthenticated
}

exports[types.SET_TERMS_CONTENT] = function (state, terms) {
  state.terms.content = terms
}

exports[types.SET_NEEDS_TO_ACCEPT_NEW_TERMS] = function (state, value) {
  state.terms.needsToAcceptNewVersion = value
}

exports[types.SET_CONNECTIVITY] = function (state, value) {
  state.connectivity.isOnline = value
}
