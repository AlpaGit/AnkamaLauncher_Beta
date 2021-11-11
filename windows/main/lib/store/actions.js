/**
 * Additionally to internal state actions,
 * we also keep the synchronisation between the
 * remote objects and this window's global state in here.
 *
 * Electron's remote objects do not play nice with reactive
 * frameworks such as Vue.js. You can refer to Electron's
 * official documentation on remote objects for more
 * details, but basically we cannot know when data changes,
 * nor will we know when attributes are added or removed
 * on an object. Also, some data structures are passed by reference
 * (Arrays, etc), which leads to surprising outcomes.
 *
 * Vuex expect data structures on the state to not
 * contain methods. This is meant to make it so that data can remain
 * functionally pure, but unfortunately adds to the complexity of the
 * data synchronisation.
 */
const ipcRenderer = require('electron').ipcRenderer
const shell = require('electron').shell
const remoteCommunication = remote.require('lib/remoteCommunication')
const zaapSettings = remote.require('lib/settings')
const types = require('./types')

/**
 * Syncs
 */

exports.syncZaapSettings = function (context) {
  const setSettings = function (settings) {
    context.commit(types.SET_SETTINGS, settings)
    i18n.locale = settings[zaapSettings.KEYS.LANGUAGE]
  }

  // callbacks
  const zaapSettingsOpenCallback = () => {
    exports.openZaapSettingsPopup(context)
  }

  const zaapSettingsUpdatedCallback = (event, settings) => {
    setSettings(settings)
  }

  // ipcRenderer is deleted when the window is closed: listeners doesn't have to be removed
  ipcRenderer.on(remoteCommunication.CHANNELS.ZAAP_SETTINGS_OPEN, zaapSettingsOpenCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.ZAAP_SETTINGS_UPDATED, zaapSettingsUpdatedCallback)

  // init state
  setSettings(ipcRenderer.sendSync(remoteCommunication.CHANNELS.ZAAP_SETTINGS_GET))
}

exports.syncReleasesFromRegistry = function (context) {
  const gameAddedCallback = (event, game) => {
    context.commit(types.SET_GAME, game)
  }

  const gameUpdatedCallback = (event, game) => {
    context.commit(types.SET_GAME, game)
  }

  const gameRemovedCallback = (event, game) => {
    context.commit(types.REMOVE_GAME, game)
  }

  const releaseUpdateUpdatedCallback = (event, update) => {
    const {
      gameUid,
      releaseName,
    } = update

    context.commit(types.SET_RELEASE_CURRENT_UPDATE, {
      gameUid,
      releaseName,
      update,
    })
  }

  const releaseNewsRefreshedCallback = (event, gameUid, releaseName, news) => {
    context.commit(types.SET_RELEASE_NEWS, {
      gameUid,
      releaseName,
      news,
    })
  }

  const newsRefreshedCallback = (event, news) => {
    context.commit(types.SET_ALL_NEWS, {
      news,
    })
  }

  // ipcRenderer is deleted when the window is closed: listeners doesn't have to be removed
  ipcRenderer.on(remoteCommunication.CHANNELS.GAME_ADDED, gameAddedCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.GAME_UPDATED, gameUpdatedCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.GAME_REMOVED, gameRemovedCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_UPDATE_UPDATED, releaseUpdateUpdatedCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_NEWS_REFRESHED, releaseNewsRefreshedCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.NEWS_REFRESHED, newsRefreshedCallback)

  // initial state
  const games = ipcRenderer.sendSync(remoteCommunication.CHANNELS.GAME_LIST)

  // get default release
  const defaultRelease = ipcRenderer.sendSync(remoteCommunication.CHANNELS.RELEASE_GET_DEFAULT)
  let hasDefaultRelease = false
  if (defaultRelease) {
    const defaultGame = games[defaultRelease.gameUid]
    if (defaultGame) {
      hasDefaultRelease = defaultGame.releases[defaultRelease.name]
    }
  }

  Object.keys(games).forEach((key) => {
    const game = games[key]
    context.commit(types.SET_GAME, game)

    const releases = game.releases
    Object.keys(releases).forEach((key) => {
      const release = releases[key]
      if (!context.getters.displayedRelease) {
        let displayRelease = !hasDefaultRelease && release.order === 0
        if (hasDefaultRelease) {
          displayRelease = release.gameUid === defaultRelease.gameUid && release.name === defaultRelease.name
        }

        if (displayRelease) {
          context.commit(types.DISPLAY_RELEASE, release)
        }
      }

      const information = release.information
      context.commit(types.SET_RELEASE_INFORMATION, {
        release,
        information,
      })

      if (release.isUpdateProcessRunning) {
        const update = release.currentUpdate
        const gameUid = release.gameUid
        const releaseName = release.name
        context.commit(types.SET_RELEASE_CURRENT_UPDATE, {
          gameUid,
          releaseName,
          update,
        })
      }

      if (release.isInstalled) {
        const configuration = release.configuration
        context.commit(types.SET_RELEASE_CONFIGURATION, {
          release,
          configuration,
        })

        const settings = release.settings
        context.commit(types.SET_RELEASE_SETTINGS, {
          release,
          settings,
        })
      }
    })
  })
}

exports.syncBuildConfig = function (context) {
  context.commit(types.SET_BUILD_CONFIG, ipcRenderer.sendSync(remoteCommunication.CHANNELS.BUILD_CONFIG_GET))
}

exports.syncWindow = function (context) {
  // callbacks
  const windowIsFocusedCallback = (event, windowIsFocused) => {
    context.commit(types.SET_WINDOW_IS_FOCUSED, windowIsFocused)
  }
  const windowIsMaximizedCallback = (event, windowIsMaximized) => {
    context.commit(types.SET_WINDOW_IS_MAXIMIZED, windowIsMaximized)
  }
  const windowIsFullscreenCallback = (event, windowIsFullscreen) => {
    context.commit(types.SET_WINDOW_IS_FULLSCREEN, windowIsFullscreen)
  }

  ipcRenderer.on(remoteCommunication.CHANNELS.WINDOW_IS_FOCUSED, windowIsFocusedCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.WINDOW_IS_MAXIMIZED, windowIsMaximizedCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.WINDOW_IS_FULLSCREEN, windowIsFullscreenCallback)

  // Minimize window when launching a release if option is active
  const minimizeWindowAtReleaseLaunchCallback = () => {
    if (context.state.settings[SETTINGS_KEYS.MINIMIZE_AT_RELEASE_LAUNCH]) {
      remote.require('windows/main/electron').hide()
    }
  }
  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_WAS_LAUNCHED, minimizeWindowAtReleaseLaunchCallback)
}

exports.syncAutoUpdater = function (context) {
  // callbacks
  const autoUpdaterProgressCallback = (event, downloadProgress) => {
    context.commit(types.SET_ZAAP_AUTO_UPDATER_PROGRESS, downloadProgress)
  }

  const autoUpdaterReadyCallback = () => {
    context.commit(types.SET_ZAAP_AUTO_UPDATER_READY)
  }

  ipcRenderer.on(remoteCommunication.CHANNELS.ZAAP_AUTO_UPDATER_PROGRESS, autoUpdaterProgressCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.ZAAP_AUTO_UPDATER_READY, autoUpdaterReadyCallback)
}

/**
 * RELEASE ACTIONS
 */

exports.displayRelease = function (context, release) {
  context.commit(types.DISPLAY_RELEASE, release)

  ipcRenderer.send(
    remoteCommunication.CHANNELS.ZAAP_SETTINGS_SET,
    zaapSettings.KEYS.LAST_OPENED_RELEASE,
    {
      gameUid: release.gameUid,
      name: release.name,
    })
}

exports.openReleaseInstallPopup = function (context) {
  context.commit(types.OPEN_RELEASE_INSTALL_POPUP)
}

exports.closeReleaseInstallPopup = function (context) {
  context.commit(types.CLOSE_RELEASE_INSTALL_POPUP)
}

exports.installRelease = function (context, {
  release,
  installPath,
}) {
  const startCallback = () => {
    context.commit(types.CLOSE_RELEASE_INSTALL_POPUP)
    clearListeners()
  }

  const errorCallback = () => {
    clearListeners()
  }

  const clearListeners = () => {
    ipcRenderer.removeListener(remoteCommunication.CHANNELS.RELEASE_INSTALL_STARTED, startCallback)
    ipcRenderer.removeListener(remoteCommunication.CHANNELS.RELEASE_INSTALL_ERROR, errorCallback)
  }

  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_INSTALL_STARTED, startCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_INSTALL_ERROR, errorCallback)

  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_INSTALL,
    release.gameUid,
    release.name,
    installPath
  )
}

exports.moveRelease = function (context, {
  release,
  newPath,
}) {
  const clearListeners = () => {
    ipcRenderer.removeListener(remoteCommunication.CHANNELS.RELEASE_MOVE_ERROR, clearListeners)
    ipcRenderer.removeListener(remoteCommunication.CHANNELS.RELEASE_MOVE_SUCCESS, clearListeners)
  }

  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_MOVE_ERROR, clearListeners)
  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_MOVE_SUCCESS, clearListeners)

  ipcRenderer.send(remoteCommunication.CHANNELS.RELEASE_MOVE,
    release.gameUid,
    release.name,
    newPath)
}

exports.openReleaseUninstallPopup = function (context) {
  context.commit(types.OPEN_RELEASE_UNINSTALL_POPUP)
}

exports.closeReleaseUninstallPopup = function (context) {
  context.commit(types.CLOSE_RELEASE_UNINSTALL_POPUP)
}

exports.uninstallRelease = function (context, {
  release,
}) {
  const doneCallback = () => {
    context.commit(types.CLOSE_RELEASE_UNINSTALL_POPUP)
    context.commit(types.CLOSE_RELEASE_SETTINGS_POPUP)
    clearListeners()
  }

  const errorCallback = () => {
    clearListeners()
  }

  const clearListeners = () => {
    ipcRenderer.removeListener(remoteCommunication.CHANNELS.RELEASE_UNINSTALL_DONE, doneCallback)
    ipcRenderer.removeListener(remoteCommunication.CHANNELS.RELEASE_UNINSTALL_ERROR, errorCallback)
  }

  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_UNINSTALL_DONE, doneCallback)
  ipcRenderer.on(remoteCommunication.CHANNELS.RELEASE_UNINSTALL_ERROR, errorCallback)

  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_UNINSTALL,
    release.gameUid,
    release.name
  )
}

exports.startRelease = function (context, {
  release,
  numberOfInstancesToStart,
}) {
  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_START,
    release.gameUid,
    release.name,
    numberOfInstancesToStart || 1,
  )
}

exports.runReleaseUpdate = function (context, {
  release,
}) {
  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_UPDATE,
    release.gameUid,
    release.name
  )
}

exports.pauseReleaseUpdate = function (context, {
  release,
}) {
  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_UPDATE_PAUSE,
    release.gameUid,
    release.name
  )
}

exports.resumeReleaseUpdate = function (context, {
  release,
}) {
  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_UPDATE_RESUME,
    release.gameUid,
    release.name
  )
}

exports.repairRelease = function (context, {
  release,
}) {
  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_REPAIR,
    release.gameUid,
    release.name
  )
}

exports.setReleaseUpdateQueueIndex = function (context, {
  release,
  index,
}) {
  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_UPDATE_SET_QUEUE_INDEX,
    release.gameUid,
    release.name,
    index
  )
}

/**
 * RELEASE SETTINGS ACTIONS
 */

exports.openReleaseSettingsPopup = function (context) {
  context.commit(types.OPEN_RELEASE_SETTINGS_POPUP)
}

exports.closeReleaseSettingsPopup = function (context) {
  context.commit(types.CLOSE_RELEASE_SETTINGS_POPUP)
}

exports.updateReleaseSettings = function (context, {
  gameUid,
  releaseName,
  settings,
}) {
  ipcRenderer.send(
    remoteCommunication.CHANNELS.RELEASE_SETTINGS_UPDATE,
    gameUid,
    releaseName,
    settings
  )
}

/**
 * RELEASE ACTIONS
 */

exports.refreshNews = function (context, release) {
  ipcRenderer.send(remoteCommunication.CHANNELS.RELEASE_NEWS_REFRESH, release.gameUid, release.name)
}

/**
 * NEWS ACTIONS
 */

exports.refreshAllNews = function (context, {
  page,
  count,
}) {
  ipcRenderer.send(remoteCommunication.CHANNELS.NEWS_REFRESH, page, count)
}


/**
 * SETTINGS ACTIONS
 */

exports.openZaapSettingsPopup = function (context) {
  context.commit(types.OPEN_ZAAP_SETTINGS_POPUP)
}

exports.closeZaapSettingsPopup = function (context) {
  context.commit(types.CLOSE_ZAAP_SETTINGS_POPUP)
}

exports.setZaapSettings = function (context, {
  settingsKey,
  value,
}) {
  ipcRenderer.send(remoteCommunication.CHANNELS.ZAAP_SETTINGS_SET, settingsKey, value)
}

/**
 * AUTH ACTIONS
 */

exports.syncAuth = function (context) {
  // callbacks
  const setAuth = (auth) => {
    context.commit(types.SET_AUTHENTICATED, auth.isAuthenticated)
  }

  const authUpdatedCallback = (event, auth) => {
    setAuth(auth)
  }

  ipcRenderer.on(remoteCommunication.CHANNELS.AUTH_UPDATED, authUpdatedCallback)

  // initial state
  setAuth(ipcRenderer.sendSync(remoteCommunication.CHANNELS.AUTH_GET))
}

/**
 * USER ACTIONS
 */

exports.syncUser = function (context) {
  ipcRenderer.on(remoteCommunication.CHANNELS.USER_RELEASE_READY, () => {
    context.commit(
      types.DISPLAY_RELEASE,
      zaapSettings.get(zaapSettings.KEYS.LAST_OPENED_RELEASE)
    )
  })
}

/**
 * SCRIPT ACTIONS
 */

exports.spawnScript = function (context, args) {
  return ipcRenderer.sendSync(remoteCommunication.CHANNELS.SPAWN_SCRIPT, args)
}

/**
 * URL ACTIONS
 */

exports.openExternal = function (context, url) {
  shell.openExternal(url)
}

/**
 * GO ANKAMA ACTIONS
 */

exports.goAnkamaOpen = function (context, keyword) {
  const url = ipcRenderer.sendSync(remoteCommunication.CHANNELS.GO_ANKAMA_GET_URL, keyword)
  shell.openExternal(url)
}

/**
 * AUTH ACTIONS
 */

exports.login = function (context, args) {
  const {
    login,
    password,
    stayLoggedIn,
  } = args

  ipcRenderer.send(remoteCommunication.CHANNELS.AUTH_LOGIN, login, password, stayLoggedIn)
}

exports.logout = function () {
  ipcRenderer.send(remoteCommunication.CHANNELS.AUTH_LOGOUT)
}

/**
 * TERMS ACTIONS
 */

exports.termsAccept = function () {
  ipcRenderer.send(remoteCommunication.CHANNELS.TERMS_ACCEPT)
}

exports.termsRefuse = function () {
  ipcRenderer.send(remoteCommunication.CHANNELS.TERMS_REFUSE)
}

exports.termsLoad = function (context) {
  context.commit(types.SET_TERMS_CONTENT, ipcRenderer.sendSync(remoteCommunication.CHANNELS.TERMS_GET))
}

exports.termsNeedsToAcceptNewVersion = function (context) {
  context.commit(
    types.SET_NEEDS_TO_ACCEPT_NEW_TERMS,
    ipcRenderer.sendSync(remoteCommunication.CHANNELS.TERMS_NEEDS_TO_ACCEPT_NEW_VERSION)
  )
}

/**
 * CONNECTIVITY ACTIONS
 */

exports.syncConnectivity = function (context) {
  const setConnectivity = (isOnline) => {
    context.commit(types.SET_CONNECTIVITY, isOnline)
  }

  ipcRenderer.on(remoteCommunication.CHANNELS.CONNECTIVITY_UPDATED, (event, isOnline) => {
    setConnectivity(isOnline)
  })

  const isOnline = ipcRenderer.sendSync(remoteCommunication.CHANNELS.CONNECTIVITY_GET)
  setConnectivity(isOnline)
}

/**
 * APP ACTIONS
 */

exports.quit = function () {
  ipcRenderer.send(remoteCommunication.CHANNELS.ZAAP_QUIT)
}
