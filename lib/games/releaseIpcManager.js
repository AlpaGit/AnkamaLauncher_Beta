const remoteCommunication = require('../remoteCommunication')
const inject = require('instill')

inject(exports, {
  appSettings: require('../settings'),
  ipcMain: require('electron').ipcMain,
  logger: require('../logger'),
  updateQueue: require('../updater/updateQueue'),
  getFolderSize: require('../getFolderSize'),
  getKpi: () => require('../kpi'),
})

// Errors
const {
  errors,
  ZaapError,
} = require('../errors').register('RELEASE_IPC_MANAGER', {
  CANNOT_GET_INSTALL_INFORMATION: 12000,
  CANNOT_GET_FOLDER_SIZE: 12001,
})

exports.errors = errors

exports.GAMEUID_ARG = '--gameUid='
exports.RELEASE_ARG = '--release='

exports.releases = []

exports.defaultRelease = null

/**
 * @summary Add a release to the manager
 * @param {Release} release - release to add
 * @returns {undefined} void
 */
exports.addRelease = function (release) {
  this.releases.push(release)
}

/**
 * @summary Remove a release from the manager
 * @param {Release} release - release to add
 * @returns {undefined} void
 */
exports.removeRelease = function (release) {
  for (let i = 0; i < this.releases.length; i += 1) {
    if (this.releases[i] === release) {
      this.releases.splice(i, 1)
      break
    }
  }
}

/**
 * @summary Return a release
 * @param {string} gameUid - gameUid of the release
 * @param {string} releaseName - name of the release
 * @returns {Release} release
 */
exports.getRelease = function (gameUid, releaseName) {
  return this.releases.find((release) => {
    return release.gameUid === gameUid && release.name === releaseName
  })
}

/**
 * @summary Setup the releaseIpcManager
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    appSettings,
    ipcMain,
  } = this.modules

  // check the release that will be opened at launch
  let gameUid, name
  process.argv.forEach((arg) => {
    if (arg.startsWith(this.GAMEUID_ARG)) {
      gameUid = arg.substr(this.GAMEUID_ARG.length)
    } else if (arg.startsWith(this.RELEASE_ARG)) {
      name = arg.substr(this.RELEASE_ARG.length)
    }
  })

  if (gameUid && name) {
    this.defaultRelease = {
      gameUid,
      name,
    }
  } else {
    this.defaultRelease = appSettings.get(appSettings.KEYS.LAST_OPENED_RELEASE)
  }

  // listen to events
  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_GET_DEFAULT,
    this.getDefault.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_GET_LOGS_PATH,
    this.getLogsPath.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_GET_INSTALL_INFORMATION,
    this.getInstallInformation.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_GET_FOLDER_SIZE,
    this.getFolderSize.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_SETTINGS_UPDATE,
    this.updateSettings.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_INSTALL,
    this.install.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_MOVE,
    this.move.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_UNINSTALL,
    this.uninstall.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_START,
    this.start.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_UPDATE,
    this.update.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_UPDATE_PAUSE,
    this.pauseUpdate.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_UPDATE_RESUME,
    this.resumeUpdate.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_REPAIR,
    this.repair.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_NEWS_REFRESH,
    this.refreshNews.bind(this)
  )

  ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_GET_LICENSES,
    this.getLicenses.bind(this)
  )
}

/**
 * @summary ipcMain event handler for RELEASE_GET_DEFAULT
 * @param {Object} event - event
 * @returns {undefined} void
 */
exports.getDefault = function (event) {
  event.returnValue = this.defaultRelease || {}
}

/**
 * @summary ipcMain event handler for RELEASE_GET_LOGS_PATH
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.getLogsPath = function (event, gameUid, releaseName) {
  const release = this.getRelease(gameUid, releaseName)

  event.returnValue = release.getLogsPath()
}

/**
 * @summary ipcMain event handler for RELEASE_GET_INSTALL_INFORMATION
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.getInstallInformation = function (event, gameUid, releaseName) {
  const {
    getKpi,
    logger,
  } = this.modules

  const {
    CANNOT_GET_INSTALL_INFORMATION,
  } = errors

  const release = this.getRelease(gameUid, releaseName)

  if (release.isInstalled()) {
    getKpi().gameUpdateHit({
      gameId: release.gameId,
      releaseName: release.name,
      autoUpdate: release.settings.get().autoUpdate,
    })
  } else {
    getKpi().gameInstallHit()
  }

  release.getInstallationSize()
    .then((size) => {
      event.returnValue = {
        suggestedPath: release.getSuggestedInstallPath(),
        requiredSpace: size,
      }
    })
    .catch((error) => {
      logger.error('releaseIpcManager: cannot get installation size', error)
      event.returnValue = {
        error: new ZaapError(
          CANNOT_GET_INSTALL_INFORMATION,
          'Cannot get installation information',
          'release.error.cannotGetInstallInformation'
        ),
      }
    })
}

/**
 * @summary ipcMain event handler for RELEASE_GET_FOLDER_SIZE
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {Promise<undefined>} Promised that resolved when the size of the folder is computed
 */
exports.getFolderSize = function (event, gameUid, releaseName) {
  const {
    logger,
    getFolderSize,
  } = this.modules

  const {
    CANNOT_GET_FOLDER_SIZE,
  } = errors

  const release = this.getRelease(gameUid, releaseName)

  if (!release.location) {
    logger.error('releaseIpcManager: cannot get folder size, no release location')
    event.returnValue = {
      error: new ZaapError(
        CANNOT_GET_FOLDER_SIZE,
        'Cannot get folder size',
        'release.error.cannotGetFolderSize'
      ),
    }

    return
  }

  return getFolderSize(release.location)
    .then((size) => {
      event.returnValue = {
        size,
      }
    })
    .catch((error) => {
      logger.error('releaseIpcManager: cannot get folder size', error)
      event.returnValue = {
        error: new ZaapError(
          CANNOT_GET_FOLDER_SIZE,
          'Cannot get folder size',
          'release.error.cannotGetFolderSize'
        ),
      }
    })
}

/**
 * @summary ipcMain event handler for RELEASE_UPDATE_SETTING
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @param {Object} newSettings - newSettings
 * @returns {undefined} void
 */
exports.updateSettings = function (event, gameUid, releaseName, newSettings) {
  const release = this.getRelease(gameUid, releaseName)

  if (release.settings) {
    release.settings.set(newSettings)
  }
}

/**
 * @summary ipcMain event handler for RELEASE_INSTALL
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @param {string} location - location
 * @returns {undefined} void
 */
exports.install = function (event, gameUid, releaseName, location) {
  const release = this.getRelease(gameUid, releaseName)

  release.install(location, true)
    .then(() => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_INSTALL_STARTED)
    })
    .catch((error) => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_INSTALL_ERROR, error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_MOVE
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @param {string} location - location
 * @returns {undefined} void
 */
exports.move = function (event, gameUid, releaseName, location) {
  const release = this.getRelease(gameUid, releaseName)

  release.move(location)
    .then(() => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_MOVE_SUCCESS)
    })
    .catch((error) => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_MOVE_ERROR, error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_UNINSTALL
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.uninstall = function (event, gameUid, releaseName) {
  const release = this.getRelease(gameUid, releaseName)

  release.uninstall()
    .then(() => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_UNINSTALL_DONE)
    })
    .catch((error) => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_UNINSTALL_ERROR, error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_START
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @param {number} numberOfInstancesToStart - number of instances to start
 * @returns {undefined} void
 */
exports.start = function (event, gameUid, releaseName, numberOfInstancesToStart = 1) {
  const release = this.getRelease(gameUid, releaseName)

  event.sender.send(remoteCommunication.CHANNELS.RELEASE_WAS_LAUNCHED)

  release.startSeries(numberOfInstancesToStart)
    .catch((error) => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_START_ERROR, error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_UPDATE
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.update = function (event, gameUid, releaseName) {
  const release = this.getRelease(gameUid, releaseName)

  release.update()
    .catch((error) => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_UPDATE_ERROR, error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_UPDATE_PAUSE
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.pauseUpdate = function (event, gameUid, releaseName) {
  const {
    logger,
    updateQueue,
  } = this.modules

  const release = this.getRelease(gameUid, releaseName)

  updateQueue.pauseCurrentUpdate(true)
    .then(() => {
      release.saveToDisk()
    })
    .catch((error) => {
      logger.error('releaseIpcManager: cannot pause current update', error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_UPDATE_RESUME
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.resumeUpdate = function (event, gameUid, releaseName) {
  const {
    updateQueue,
  } = this.modules

  const release = this.getRelease(gameUid, releaseName)

  updateQueue.resumeUpdate(gameUid, releaseName, true)
  release.saveToDisk()
}

/**
 * @summary ipcMain event handler for RELEASE_REPAIR
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.repair = function (event, gameUid, releaseName) {
  const release = this.getRelease(gameUid, releaseName)

  release.repair()
    .catch((error) => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_REPAIR_ERROR, error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_NEWS_REFRESHED
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.refreshNews = function (event, gameUid, releaseName) {
  const {
    logger,
  } = this.modules

  const release = this.getRelease(gameUid, releaseName)

  release.refreshNews()
    .then(() => {
      event.sender.send(remoteCommunication.CHANNELS.RELEASE_NEWS_REFRESHED, gameUid, releaseName, release.news)
    })
    .catch((error) => {
      /* istanbul ignore next */
      logger.error('release: cannot refresh news', error)
    })
}

/**
 * @summary ipcMain event handler for RELEASE_GET_LICENSE
 * @param {Object} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {undefined} void
 */
exports.getLicenses = function (event, gameUid, releaseName) {
  const release = this.getRelease(gameUid, releaseName)

  event.returnValue = release.licenses
}
