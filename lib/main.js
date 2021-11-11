/**
 * Boilerplate:
 *
 *  1. Force every modules to "use strict"
 *  2. Load sentry (will start reporting fatal errors)
 *  3. Start the app
 *  4. Check if we have an update - self-update and restart if we do
 *
 * @module zaap
 */
require('use-strict')
require('rootpath')()

// Synchronously-loaded dependencies
const path = require('path')
const fs = require('fs')
const os = require('os')
const ipcMain = require('electron').ipcMain
const buildConfig = require('./buildConfig')
const logger = require('./logger')
const remoteCommunication = require('./remoteCommunication')

this.platform = process.platform

this.BOOTSTRAP_GAMES_REGISTRY_RETRY_DELAY_IN_MS = 1000
this.BOOTSTRAP_GAMES_REGISTRY_MAX_TRIES_COUNT = 3
this.BOOTSTRAP_DELAY = 3 * 60 * 1000

// Lazy-loaded dependencies
let sentry = null

// App state
this.isMainWindowReady = false

// Cytrus URL
let server = null

// Crash filename
this.crashFilename = ''

/**
 * Setup Sentry to capture crashes.
 * We catch all uncaught errors, log them,
 * send them to sentry and then exit
 *
 * @param {Error} error - error to send to Sentry
 * @returns {undefined} void
 */
exports.sendToSentry = (error) => {
  const fs = require('fs-extra')

  if (!sentry) {
    sentry = require('./sentry')
    sentry.setup()
  }

  sentry.captureException(error, () => {
    /* istanbul ignore next */
    logger.error('Exiting application because a fatal error has occured')

    let crashData = {
      count: 0,
    }
    if (fs.existsSync(this.crashFilename)) {
      try {
        crashData = JSON.parse(fs.readFileSync(this.crashFilename))
      } catch (error) {
        /* istanbul ignore next */
        logger.error('Unable to parse crash.json', error)
      }
    }

    crashData.count += 1
    try {
      fs.ensureFileSync(this.crashFilename)
      fs.writeFileSync(this.crashFilename, JSON.stringify(crashData))
    } catch (error) {
      /* istanbul ignore next */
      logger.error('Unable to write crash.json', error)
    }

    this.app.isQuitting = true
    try {
      this.app.exit(1)
    } catch (error) {
      process.exit(1)
    }
  })
}

exports.setup = () => {
  /**
   * Errors registration
   */
  const errorClassAndCodes = require('./errors').register('BOOTSTRAP', {
    BOOTSTRAP_MAX_TRIES_REACHED: 10000,
  })

  this.error = errorClassAndCodes.errors
  this.ZaapError = errorClassAndCodes.ZaapError

  /**
   * Load build configuration
   */
  buildConfig.setup()
  server = buildConfig.cytrus.repository
  if (buildConfig.allowInsecureHttps === true) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  /**
   * Set crash filename
   */
  switch (this.platform) {
    case 'darwin':
      this.crashFilename = path.join(os.homedir(), 'Library', 'Logs', buildConfig.name, 'crash.json')
      break
    case 'win32':
      this.crashFilename = path.join(os.homedir(), 'AppData', 'Roaming', buildConfig.name, 'crash.json')
      break
    case 'linux':
      this.crashFilename = path.join(os.homedir(), '.config', buildConfig.name, 'crash.json')
      break
  }

  /**
   * Setup logger
   */
  logger.setup()

  process.on('uncaughtException', (error) => {
    /* istanbul ignore next */
    logger.error('A fatal error occured (uncaught exception)', error)
    this.sendToSentry(error)
  })

  process.on('unhandledRejection', (error) => {
    /* istanbul ignore next */
    logger.error('A fatal error occurred (unhandled rejection)', error)
    this.sendToSentry(error)
  })

  /**
   * Setup goAnkama
   */

  require('./goAnkama').setup()

  /**
   * Setup the application
   */
  const app = this.app = require('./app')
  app.setup()

  /**
   * Prevent a native app.quit() when all windows are closed
   */
  app.on('window-all-closed', (event) => {
    event.preventDefault()
  })

  /**
   * Mac only: open main window when user click on reduced app icon
   */
  app.on('activate', () => {
    app.openWindow('main')
  })

  /**
   * Log that the app is ready to go
   * Load and open main window
   * Lazy-load all other modules
   */
  app.on('ready', () => {
    /* istanbul ignore next */
    logger.info('index: ready - version', app.getVersion())

    if (!server) {
      throw new Error('Cytrus repository server is not set in your build config!')
    }

    /**
     * Load all app windows
     */
    /* istanbul ignore next */
    logger.info('index: loading all windows')
    const windowsPath = path.join(__dirname, '..', 'windows')
    app.loadWindows(windowsPath)

    this.checkUpdateIfCrash().then((willUpdate) => {
      if (willUpdate) {
        return
      }

      /**
       * Open main window if needed:
       * we should not open main window if app was started by OS or after a self-update
       */
      if (!app.wasOpenedAsHidden()) {
        /* istanbul ignore next */
        logger.info('index: open main window')
        app.openWindow('main')
        ipcMain.once(remoteCommunication.CHANNELS.MAIN_WINDOW_READY, () => {
          this.isMainWindowReady = true
          app.emit('zaap-main-window-is-ready')
        })
      } else {
        /* istanbul ignore next */
        logger.info('index: opened as hidden, do not open main window')
        this.isMainWindowReady = true
      }

      /**
       * Start checking for connectivity.
       *
       * We check if we can resolve the domain name of
       * the repository server. If we cannot, we consider
       * ourselves offline.
       */
      this.connectivity = require('./connectivity')
      this.connectivity.setup()
      this.connectivity.watch(server)

      if (!this.connectivity.isOnline) {
        /* istanbul ignore next */
        logger.info('index: We are currently offline, waiting to be online before running bootstrap...')
        this.connectivity.once('online', this.bootstrap)
      } else {
        this.bootstrap()
      }
    })
  })
}

/**
 * @summary Check for an update after multiple crash
 * @returns {Promise} True if an update is ready for install
 */
exports.checkUpdateIfCrash = () => {
  return new Promise((resolve) => {
    if (!buildConfig.isBuild || !fs.existsSync(this.crashFilename)) {
      return resolve(false)
    }

    try {
      const crashData = JSON.parse(fs.readFileSync(this.crashFilename))
      if (crashData.count && crashData.count < 2) {
        return resolve(false)
      }
    } catch (error) {
      /* istanbul ignore next */
      logger.error('index: Unable to parse crash.json', error)
      fs.unlink(this.crashFilename, (error) => {
        /* istanbul ignore next */
        logger.error('index: Unable to delete crash.json', error)
      })
      return resolve(false)
    }

    const autoUpdater = require('./autoUpdater')
    if (!autoUpdater.setup()) {
      return resolve(false)
    }

    autoUpdater.once('updateError', () => resolve(false))
    autoUpdater.once('updateNotAvailable', () => resolve(false))
    autoUpdater.once('updateDownloaded', () => resolve(true))
  })
}

let hasBootstrap = false
exports.bootstrapOnce = () => {
  if (hasBootstrap) {
    return
  }

  hasBootstrap = true

  this.primarySetups()
  this.bootstrapGamesRegistry()
  this.delayedSetups()
}

/**
 * We are online but we only want bootstrap
 * when main window is loaded
 * or if no window should be open
 *
 * @return {undefined} void
 */
exports.bootstrap = () => {
  if (this.isMainWindowReady) {
    this.bootstrapOnce()
  } else if (!this.app.wasOpenedAsHidden()) {
    this.app.once('zaap-main-window-is-ready', this.bootstrapOnce)
  } else {
    setTimeout(this.bootstrapOnce, this.BOOTSTRAP_DELAY)
  }
}

exports.primarySetups = () => {
  /**
   * Setup Tray (and menu for mac)
   * It's done after the loadWindows to avoid the "window not found" error if the user clicks quickly
   */
  require('./tray').setup()
  if (this.platform === 'darwin') {
    require('./menu').setup()
  }

  /**
   * Try to authenticate user from stored API Key
   */
  const auth = require('./auth')
  auth.setup()
  auth.once('logged-in', this.delayedSetupsAfterLogin)
  auth.authenticateFromStoredApiKey()

  /**
   * Setup user
   */
  const user = require('./user')
  user.setup()

  /**
   * Store and emit that main process is ready
   * @returns {undefined} void
   */
  function sendMainProcessIsReady() {
    remoteCommunication.send(remoteCommunication.CHANNELS.MAIN_PROCESS_READY)
  }
  sendMainProcessIsReady()

  // Allows us to (re)open main window later
  ipcMain.on(remoteCommunication.CHANNELS.IS_MAIN_PROCESS_READY, sendMainProcessIsReady)
}

let gamesRegistry
exports.bootstrapGamesRegistry = (bootstrapGamesRegistryTriesCount = 0) => {
  if (bootstrapGamesRegistryTriesCount >= this.BOOTSTRAP_GAMES_REGISTRY_MAX_TRIES_COUNT) {
    throw new this.ZaapError(
      this.errors.BOOTSTRAP_MAX_TRIES_REACHED,
      'Unable to bootstrap: maximum tries count reached')
  }

  require('./updater/updateQueue').setup()
  gamesRegistry = require('./games/registry')
  gamesRegistry.setup(server, (error) => {
    if (error) {
      /* istanbul ignore next */
      logger.warn(`Repository was set but could not fetch initial games list`, error)
      return setTimeout(() => {
        this.bootstrapGamesRegistry(bootstrapGamesRegistryTriesCount + 1)
      }, this.BOOTSTRAP_GAMES_REGISTRY_RETRY_DELAY_IN_MS)
    }

    require('./games/releaseIpcManager').setup()

    gamesRegistry.watchRepository()

    this.connectivity.on('online', () => {
      /* istanbul ignore next */
      logger.info('index: We are back online, resuming watch of repository')
      gamesRegistry.watchRepository()
    })
    this.connectivity.on('offline', () => {
      /* istanbul ignore next */
      logger.info('index: We are offline, pausing watch of repository')
      gamesRegistry.unwatchRepository()
    })
  })
}

exports.delayedSetups = () => {
  /**
   * Setup auto-update
   */
  const autoUpdater = require('./autoUpdater')
  autoUpdater.once('updateDownloaded', () => {
    if (fs.existsSync(this.crashFilename)) {
      fs.unlinkSync(this.crashFilename, (error) => {
        /* istanbul ignore next */
        if (error) {
          logger.error('index: Unable to delete crash.json', error)
        }
      })
    }
  })
  autoUpdater.setup()

  /**
   * Setup autoLaunch
   */
  require('./autoLaunch').setup()

  /**
   * Setup News
   */
  const NewsIpcManager = require('./newsIpcManager')
  new NewsIpcManager()

  /**
   * Terms
   */
  const terms = require('./terms')
  terms.setup()
  terms.update().catch((error) => {
    /* istanbul ignore next */
    logger.warn(`index: Unable to update terms`, error)
  })
}

exports.delayedSetupsAfterLogin = () => {
  /**
   * Start Zaap Service API
   */
  require('./service').start((error) => {
    /* istanbul ignore next */
    if (error) {
      logger.error('index: service: service startup failure', error)
    }
  })

  /**
   * Setup scriptSpawner
   */
  require('./scriptSpawner').setup()
}
