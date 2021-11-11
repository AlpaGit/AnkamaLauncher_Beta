/**
 * AutoUpdater module manage the zaap self-update
 * based on electron builder autoUpdater
 *
 * @module zaap/autoUpdater
 */
const inject = require('instill')
const util = require('util')
const EventEmitter = require('events')
const ipcMain = require('electron').ipcMain

const CHECK_UPDATE_INTERVAL_MS = 10 * 60 * 1000

let isSetup = false


const AutoUpdater = function () {
}
util.inherits(AutoUpdater, EventEmitter)
module.exports = exports = new AutoUpdater()

inject(exports, {
  buildConfig: require('./buildConfig'),
  getElectronAutoUpdater() {
    return require('electron-updater').autoUpdater
  },
  service: require('./service'),
  connectivity: require('./connectivity'),
  app: require('./app'),
  remoteCommunication: require('./remoteCommunication'),
  logger: require('./logger'),
  setInterval(callback, ms) {
    /* istanbul ignore next */
    setInterval(callback, ms)
  },
  clearInterval(intervalId) {
    /* istanbul ignore next */
    clearInterval(intervalId)
  },
  isSetup() {
    return isSetup
  },
})

exports.isDownloading = false

/**
 * @summary Set up autoUpdater URL
 * @return {Boolean} true if setup success
 */
exports.setup = function () {
  const {
    getElectronAutoUpdater,
    buildConfig,
    connectivity,
    app,
    remoteCommunication,
    logger,
  } = this.modules

  // Avoid crash due to logger
  const proxyfiedLogger = new Proxy(logger, {
    get(target, propKey) {
      const origMethod = target[propKey]
      return function (...args) {
        try {
          origMethod.apply(this, args)
        } catch (err) {
        }
      }
    },
  })

  const autoUpdater = getElectronAutoUpdater()
  autoUpdater.allowDowngrade = true
  autoUpdater.logger = proxyfiedLogger

  if (!buildConfig.isBuild) {
    logger.warn('autoUpdater: disabled when not running in a build')
    return false
  } else if (!buildConfig.autoupdater) {
    logger.warn('autoUpdater: disabled, not configured')
    return false
  }

  try {
    const url = buildConfig.autoupdater.url
    const feedUrl = `${url}/${buildConfig.environment}`

    logger.info('autoUpdater: feed url set to:', feedUrl)

    autoUpdater.setFeedURL(feedUrl)
    autoUpdater.checkForUpdates()
  } catch (error) {
    logger.error('autoUpdater: failed to set autoUpdater feed URL:', error.message)
    return false
  }

  autoUpdater.on('error', (event, message) => {
    logger.error('autoUpdater: error,', message, event)
    this.emit('updateError')
  })

  autoUpdater.on('update-not-available', () => {
    this.emit('updateNotAvailable')
  })

  autoUpdater.on('update-available', () => {
    this.isDownloading = true
    this.emit('downloadStarted')
    logger.info('autoUpdater: An update is available')
  })

  autoUpdater.on('download-progress', (downloadProgress) => {
    if (!app.windows.main || !app.windows.main.activeWindow || !app.windows.main.activeWindow.isVisible()) {
      return
    }

    remoteCommunication.send(remoteCommunication.CHANNELS.ZAAP_AUTO_UPDATER_PROGRESS, {
      percent: downloadProgress.percent,
      transferred: downloadProgress.transferred,
      total: downloadProgress.total,
      bytesPerSecond: downloadProgress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', () => {
    logger.info('autoUpdater: an update has been downloaded and is ready for install')
    this.emit('updateDownloaded')

    if (!app.windows.main || !app.windows.main.activeWindow || !app.windows.main.activeWindow.isVisible()) {
      logger.info('autoUpdater: quit and install triggered')
      app.createHiddenFile()
      app.isQuitting = true
      return autoUpdater.quitAndInstall(true, true)
    }

    logger.info('autoUpdater: ask user to restart')
    remoteCommunication.send(remoteCommunication.CHANNELS.ZAAP_AUTO_UPDATER_READY)
  })

  ipcMain.on(remoteCommunication.CHANNELS.ZAAP_AUTO_UPDATER_INSTALL, () => {
    logger.info('autoUpdater: user has asked for a quit and install')
    app.isQuitting = true
    autoUpdater.quitAndInstall()
  })

  ipcMain.on(remoteCommunication.CHANNELS.ZAAP_AUTO_UPDATER_CHECK, () => {
    logger.info('autoUpdater: manually check for updates')
    autoUpdater.checkForUpdates()
  })

  connectivity.on('online', () => {
    this.setCheckForUpdatesInterval()
  })

  connectivity.on('offline', () => {
    this.clearCheckForUpdatesInterval()
  })

  if (connectivity.isOnline) {
    this.setCheckForUpdatesInterval()
  }

  isSetup = true

  return true
}

/**
 * @summary Set checkForUpdates interval
 * @returns {undefined} void
 */
exports.setCheckForUpdatesInterval = function () {
  const {
    setInterval,
  } = this.modules

  this.checkUpdateInterval = setInterval(this.checkForUpdates.bind(this), CHECK_UPDATE_INTERVAL_MS)
}

/**
 * @summary Clear checkForUpdates interval
 * @returns {undefined} void
 */
exports.clearCheckForUpdatesInterval = function () {
  const {
    clearInterval,
  } = this.modules

  clearInterval(this.checkUpdateInterval)
}

/**
 * @summary Check for updates (if no game is running)
 * @returns {undefined} void
 */
exports.checkForUpdates = function () {
  const {
    getElectronAutoUpdater,
    isSetup,
    service,
    logger,
  } = this.modules

  if (!isSetup()) {
    logger.info('autoUpdater: not setup, could be not configured or disabled')
    return
  }

  if (!service.hasConnectedProcesses()) {
    getElectronAutoUpdater().checkForUpdates()
  }
}
