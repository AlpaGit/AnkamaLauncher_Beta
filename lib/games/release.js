/**
 * Releases are the game instances themselves. A game may have many releases
 * (alpha, beta, main) at once, and each release will have its own configuration,
 * settings and display information.
 *
 * @summary Game release.
 * @module zaap/games/release
 */
const deepCopy = require('deep-copy')
const path = require('path')
const inject = require('instill')
const util = require('util')
const EventEmitter = require('events')
const releaseMigration = require('./releaseMigration')
const ratings = require('./ratings')
const licenses = require('./licenses')
const helpers = require('./helpers')
const PLATFORM = helpers.getRepositoryPlatform()

// Errors
const {
  errors,
  ZaapError,
} = require('../errors').register('RELEASE', {
  // General
  NOT_INSTALLED: 5000,
  ALREADY_INSTALLED: 5001,
  UPDATE_RUNNING: 5002,
  UPDATE_AVAILABLE: 5003,
  CANNOT_UPDATE_WHILE_OFFLINE: 5004,
  IS_RUNNING: 5005,
  USER_PERMISSIONS: 5015,
  IS_MOVING: 5016,
  SAME_FOLDER: 5017,
  NOT_ENOUGH_SPACE: 5018,
  CYTRUS_VERSION_NOT_HANDLED: 5020,

  // install, update processes
  LOCATION_NOT_SET: 5006,
  LOCATION_IS_A_GAME_DIRECTORY: 5007,
  LOCATION_NOT_FOUND: 5008,
  LOCATION_NOT_A_DIRECTORY: 5009,
  LOCATION_NOT_EMPTY: 5010,

  // start and stop - process management
  MAX_RUNNING_INSTANCES_REACHED: 5011,
  PROCESS_NOT_FOUND: 5012,
  UNKNOWN_FILE_ERROR: 5013,
})

exports.errors = errors

/* istanbul ignore next */
inject(exports, {
  actionFactory: require('../updater/actions/updateActionFactory'),
  appSettings: require('../settings'),
  settings: require('./settings'),
  information: require('./information'),
  configuration: require('./configuration'),
  connectivity: require('../connectivity'),
  disk: require('../disk'),
  service: require('../service'),
  logger: require('../logger'),
  shortcut: require('../shortcut'),
  Update: require('../updater/update'),
  updateQueue: require('../updater/updateQueue'),
  scriptSpawner: require('../scriptSpawner'),
  platform: process.platform,
  fs: require('fs-extra'),
  recursive: require('recursive-readdir'),
  getFolderSize: require('../getFolderSize'),
  tmp: require('tmp'),
  buildConfig: require('../buildConfig'),
  remoteCommunication: require('../remoteCommunication'),
  releaseChecker: require('./releaseChecker'),
  releaseIpcManager: require('./releaseIpcManager'),
  news: require('../news'),
  checkConfiguration: require('./checkConfiguration'),
  pathHelper: require('../pathHelper'),
  getKpi: () => require('../kpi'),
  update: require('../updater/update'),
  CYTRUS_VERSION: require('../updater/repository').CYTRUS_VERSION,
  DEFAULT_LAUNCHING_WAIT_IN_MS: 2000,
})

const SCHEMA_VERSION_KEY = '_schemaVersion'
const SCHEMA_VERSION = 1
const RELEASE_FILE_NAME = 'release.json'
const DEFAULT_RELEASE_DATA = {
  [SCHEMA_VERSION_KEY]: SCHEMA_VERSION,
  location: false,
  installedFragments: [],
  version: false,
  repositoryVersion: false,
  settings: false,
  configuration: false,
  isInstalling: false,
  isUpdating: false,
  isRepairing: false,
  updateDownloadedSize: 0,
  updateDownloadedSizeDate: null,
  updatePausedByUser: false,
  currentUpdate: false,
  runningInstances: [],
}

exports.GAME_INSTALL_SEC_30_MS = 30 * 1000

const UPDATE_DOWNLOADED_SIZE_LIFETIME_IN_MS = 24 * 60 * 60 * 1000

/**
 * @summary Create a new Release instance
 * @param {string} gameUid - The uid of the game this release belongs to.
 * @param {Number} gameId - The id of the game this release belongs to.
 * @param {Number} gameOrder - The order of the game this release belongs to.
 * @param {string} gameName - The name of the game this release belongs to.
 * @param {string} releaseName - The name of this release instance.
 * @param {Repository} repository - Repository to run update and repairs against.
 * @param {string} filepath - Where to read/write release data from/to.
 * @returns {Release} - Release object
 */
exports.get = function (gameUid, gameId, gameOrder, gameName, releaseName, repository, filepath) {
  return new Release(gameUid, gameId, gameOrder, gameName, releaseName, repository, filepath, this.modules)
}

/**
 * @summary Release object
 * @param {string} gameUid - The uid of the game this release belongs to.
 * @param {Number} gameId - The id of the game this release belongs to.
 * @param {Number} gameOrder - The order of the game this release belongs to.
 * @param {string} gameName - The name of the game this release belongs to.
 * @param {string} releaseName - The name of this release instance.
 * @param {Repository} repository - Repository to run update and repairs against.
 * @param {string} filepath - Where to read/write release data from/to.
 * @param {Object} [modules] - Injected modules to use.
 *
 * @public
 * @constructor
 */
const Release = function (
  gameUid,
  gameId,
  gameOrder,
  gameName,
  releaseName,
  repository,
  filepath,
  modules = exports.modules) {
  Object.defineProperty(this, 'modules', {
    value: modules,
    enumerable: false,
  })

  const {
    tmp,
  } = this.modules


  // Setup internal attributes
  Object.defineProperty(this, '_repository', {
    value: repository,
    enumerable: false,
    configurable: true,
  })

  this._filepath = filepath
  this.gameUid = gameUid
  this.gameId = gameId
  this.gameOrder = gameOrder
  this.gameName = gameName
  this.name = releaseName
  this.news = []
  this.tmpLocation = tmp.dirSync().name
  this.instancesToRestart = []
}

util.inherits(Release, EventEmitter)

Release.prototype.setup = function () {
  const {
    fs,
    logger,
    releaseIpcManager,
  } = this.modules

  releaseIpcManager.addRelease(this)

  fs.accessSync(this._filepath)

  // Attempt to load from disk
  this.loadFromDisk()

  if (this.isDirty || this.isRepairing || (this.isInstalling && this.location)) {
    this.isDirty = false
    this.isInstalling = false
    this.repair()
      .catch((error) => {
        logger.error('release: cannot repair', error)
      })
  } else if (this.isUpdating) {
    this.update()
      .catch((error) => {
        logger.error('release: cannot update', error)
      })
  }

  if (this.isMoving) {
    // reset isMoving to ignore the "this release is already moving" error
    const targetDir = this.isMoving
    this.isMoving = false
    /**
     * as the target folder is not empty,
     * the move operation will fail if
     * the locationIsInstallable checks
     * are not skipped
     */
    this.move(targetDir, true)
      .catch((error) => {
        logger.error('release: cannot move', error)
      })
  }

  // licenses
  this.licenses = licenses.get(this.configuration.licensesFolder, this._filepath)
}

/**
 * Clear the data and the listeners.
 * Must be called when the release is no longer used.
 *
 * @summary Destroy the release.
 * @return {undefined} void
 */
Release.prototype.destroy = function () {
  const {
    releaseIpcManager,
  } = this.modules

  releaseIpcManager.removeRelease(this)

  this.setConfiguration(false)
  this.setSettings(false)

  if (this.isUpdateProcessRunning()) {
    this.cancelCurrentUpdate()
  }
}

/**
 * @summary Refresh news
 * @returns {Promise} Promise object
 */
Release.prototype.refreshNews = function () {
  const {
    news,
  } = this.modules

  if (this.information && this.information.default.news) {
    return news.get(
      this.information.default.news
    ).then((news) => {
      this.news = news
    })
  } else {
    return new Promise((resolve) => {
      resolve([])
    })
  }
}

/**
 * @summary Load data pertaining to the release from disk.
 * @returns {undefined} void
 */
Release.prototype.loadFromDisk = function () {
  const {
    logger,
    fs,
    information,
    releaseChecker,
  } = this.modules

  const filepath = path.join(this._filepath, RELEASE_FILE_NAME)
  let releaseData

  try {
    const data = fs.readFileSync(filepath)
    releaseData = JSON.parse(data)
    releaseMigration(releaseData)
    releaseChecker(releaseData)
  } catch (error) {
    logger.warn(`Failed to load release file ${filepath}:`, error.message)
    releaseData = {}
  }

  // Load information
  releaseData.information = information.get(this._filepath)

  // Do not overwrite runningInstances
  if (this.runningInstances) {
    releaseData.runningInstances = this.runningInstances
  }

  // Do not overwrite currentUpdate
  if (this.currentUpdate) {
    releaseData.currentUpdate = this.currentUpdate
  }

  Object.assign(this, deepCopy(DEFAULT_RELEASE_DATA), releaseData)

  if (this.location) {
    this.loadLocation()
  }
}

/**
 * Should loading the configuration fails, we will mark the
 * current release instance as dirty
 *
 * @summary Attempt to load this release's configuration object
 * @param {String} [location] location of the release
 * @returns {undefined} void
 */
Release.prototype.loadConfiguration = function (location = this.location) {
  const {
    configuration,
  } = this.modules

  // don't create another configuration if there is already one
  if (!this.configuration) {
    this.setConfiguration(configuration.get(this, location))
  }

  try {
    this.configuration.load()
  } catch (error) {
    this.isDirty = true
    this.saveToDisk()
    throw error
  }
}

/**
 * @summary Set whether the location on disk should be considered available
 * @param {boolean} available should be true if the location is available, false otherwise
 * @returns {undefined} void
 */
Release.prototype.setLocationAvailability = function (available) {
  const {
    logger,
    settings,
  } = this.modules

  this.isLocationAvailable = available

  if (available) {
    this.setSettings(settings.get(this.location, this.name))

    try {
      this.loadConfiguration()
    } catch (error) {
      logger.error('Failed to load release configuration while reloading release information from file')
    }
  } else {
    this.setSettings(false)
    this.setConfiguration(false)
  }
}

/**
 * @summary Set settings
 * @param {Settings|Boolean} value - the new settings
 * @returns {undefined} void
 */
Release.prototype.setSettings = function (value) {
  if (this.settings) {
    this.settings.removeListener('update', this._settingsUpdateCallback)
  }

  this.settings = value
  if (this.settings) {
    this._settingsUpdateCallback = this.settingsUpdateCallback.bind(this)
    this.settings.on('update', this._settingsUpdateCallback)
  }
}

/**
 * @summary Settings update callback
 * @returns {undefined} void
 */
Release.prototype.settingsUpdateCallback = function () {
  setTimeout(() => {
    if (!!this.configuration) {
      this.runHook('settings_changed')
    }
  })
  this.emit('settings_changed', this)

  // launch the update if required & autoUpdate is on & no running instance
  const installedAndAutoUpdate = this.isInstalled() && this.settings.get().autoUpdate
  const notRunningOrUpdating = !this.isRunning() && !this.isUpdateProcessRunning()
  if (installedAndAutoUpdate && notRunningOrUpdating && this.isUpdateAvailable()) {
    this.update()
  }

  this.emit('update')
}

/**
 * @summary Set configuration
 * @param {Configuration|Boolean} value - the new configuration
 * @returns {undefined} void
 */
Release.prototype.setConfiguration = function (value) {
  if (this.configuration) {
    this.configuration.removeListener('update', this.configurationUpdateCallback)
    this.configuration.removeEventListeners()
  }

  this.configuration = value

  if (this.configuration) {
    this.configurationUpdateCallback = this.configurationUpdateEventHandler.bind(this)
    this.configuration.on('update', this.configurationUpdateCallback)
  }
}

/**
 * @summary Configuration update callback
 * @returns {undefined} void
 */
Release.prototype.configurationUpdateEventHandler = function () {
  this.emit('update')
}

/**
 * @summary Verify if the location is present on disk, and watch it
 * @returns {undefined} void
 */
Release.prototype.loadLocation = function () {
  const {
    fs,
  } = this.modules

  const {
    location,
  } = this

  try {
    fs.accessSync(location)
    this.setLocationAvailability(true)
  } catch (error) {
    // Error means the location is not available
    this.setLocationAvailability(false)
  }

  this.locationWatcher = fs.watchFile(location, (stats) => {
    this.setLocationAvailability(stats.dev !== 0)
  })
}

/**
 * @summary Forget the location, and stop watching it for changes
 * @returns {undefined} void
 */
Release.prototype.forgetLocation = function () {
  this.setLocationAvailability(false)

  this.location = false

  if (this.locationWatcher) {
    this.locationWatcher.stop()
    delete this.locationWatcher
  }
}

/**
 * @summary Save the release instance to disk.
 * @param {boolean} emitUpdateEvent - emit an update event
 * @returns {undefined} void
 */
Release.prototype.saveToDisk = function (emitUpdateEvent = true) {
  const {
    logger,
    fs,
  } = this.modules

  const filepath = path.join(this._filepath, RELEASE_FILE_NAME)

  try {
    const copy = {
      gameUid: this.gameUid,
      gameId: this.gameId,
      gameOrder: this.gameOrder,
      gameName: this.gameName,
      name: this.name,
      location: this.location,
      version: this.version,
      repositoryVersion: this.repositoryVersion,
      installedFragments: this.installedFragments,
      isInstalling: this.isInstalling,
      isUpdating: this.isUpdating,
      isRepairing: this.isRepairing,
      isMoving: this.isMoving,
      updateDownloadedSize: this.updateDownloadedSize,
      updateDownloadedSizeDate: this.updateDownloadedSizeDate,
      updatePausedByUser: this.currentUpdate && this.currentUpdate.isPausedByUser,
      isDirty: this.isDirty,
      [SCHEMA_VERSION_KEY]: SCHEMA_VERSION,
    }

    fs.writeFileSync(filepath, JSON.stringify(copy))
  } catch (error) {
    /* istanbul ignore next */
    logger.warn(`Failed to write release file ${filepath}:`, error.message)
  }

  if (emitUpdateEvent) {
    this.emit('update')
  }
}

/**
 * @summary Update the repository version and launch or restart an update if needed
 * @param {Number} gameId - the repository version
 * @param {Number} gameOrder - the repository version
 * @param {String} gameName - the repository version
 * @return {undefined} void
 */
Release.prototype.updateGameData = function (gameId, gameOrder, gameName) {
  this.gameId = gameId
  this.gameOrder = gameOrder
  this.gameName = gameName
  this.saveToDisk()
}

/**
 * @summary Update the repository version and launch or restart an update if needed
 * @param {string} repositoryVersion - the repository version
 * @return {undefined} void
 */
Release.prototype.setRepositoryVersion = function (repositoryVersion) {
  this.repositoryVersion = repositoryVersion
  this.launchOrRestartUpdateIfNeeded()
}

/**
 * @summary Launch or restart an update if needed
 * @return {undefined} void
 */
Release.prototype.launchOrRestartUpdateIfNeeded = function () {
  const {
    logger,
  } = this.modules

  if (this.isUpdateAvailable()) {
    if (this.currentUpdate && this.currentUpdate.version === this.repositoryVersion) {
      return
    }

    if (this.isInstalling && this.currentUpdate) {
      logger.debug('release: new release version available, restarting install')
      this.restartInstall()
        .catch((error) => {
          logger.error('release: cannot restartInstall', error)
        })
    } else if (this.isUpdating && this.currentUpdate) {
      logger.debug('release: new release version available, restarting update')
      this.restartUpdate()
        .catch((error) => {
          logger.error('release: cannot restartUpdate', error)
        })
    } else if (this.isRepairing && this.currentUpdate) {
      logger.debug('release: new release version available, restarting repair')
      this.restartRepair()
        .catch((error) => {
          logger.error('release: cannot restartRepair', error)
        })
    } else if (this.settings && this.settings.get().autoUpdate) {
      logger.debug('release: new release version available, auto-update')
      if (this.isRunning()) {
        this.updateOnExit = true
      } else {
        this.update()
          .catch((error) => {
            logger.error('release: cannot update', error)
          })
      }
    }
  }
}

/**
 * The repository version is part of the data that we will
 * cache and write to disk. In normal cases, if a game is no longer
 * available in a repository, it will be deleted from the local listing;
 * however, in the case where the game release is installed on disk,
 * the instance is kept until the game is uninstalled.
 *
 * @summary Check if the game release is still available in the repository.
 * @returns {boolean} True if the release is available in the repository
 */
Release.prototype.isInRepository = function () {
  return !!this.repositoryVersion
}

/**
 * @summary Check if the release is installed.
 * @returns {boolean} True if installed.
 */
Release.prototype.isInstalled = function () {
  return !!this.version
}

/**
 * This normally happens when the compiled configuration fragments list
 * is modified through settings or repository version is greater than installed one
 *
 * @summary Check if an update is required.
 * @returns {boolean} True if an update is required.
 */
Release.prototype.isUpdateAvailable = function () {
  if (!this.isInstalled()) {
    return false
  }

  if (!this.configuration || !this.configuration.fragments) {
    return false
  }

  for (let i = 0; i < this.configuration.fragments.length; i++) {
    if (!this.installedFragments.includes(this.configuration.fragments[i])) {
      return true
    }
  }

  return this.isInRepository() && this.version !== this.repositoryVersion
}

/**
 * @summary Check if at least one instance of the release is running.
 * @returns {boolean} True if at least one instance of the game release is running.
 */
Release.prototype.isRunning = function () {
  return this.runningInstances.length > 0
}

/**
 * @summary Check if we are currently updating.
 * @returns {boolean} True if an install, update or repair us currently running.
 */
Release.prototype.isUpdateProcessRunning = function () {
  return !!this.currentUpdate
}

/**
 * @summary Return the number of currently running game release instances.
 * @returns {Number} Number of currently running instances.
 */
Release.prototype.getRunningInstancesCount = function () {
  return this.runningInstances.length
}

/**
 * The number of maximum instances is set by the game configuration;
 * by default, only one instance is allowed to run at any time.
 *
 * @summary Check if we are already running the maximum number of instances.
 * @returns {boolean} True if we are running the maximum number of instances allowed by configuration.
 */
Release.prototype.isMaxRunningInstances = function () {
  if (this.configuration.maxInstances === true) {
    return false
  }

  return this.getRunningInstancesCount() >= this.configuration.maxInstances
}

/**
 * @summary Returns the path to the log
 * @returns {string} path to the log
 */
Release.prototype.getLogsPath = function () {
  const {
    logger,
  } = this.modules

  return path.join(logger.logdir, this.getFolderName())
}

/**
 * @summary Returns the sub-folder name based on the release type
 * @returns {string} sub-folder name
 */
Release.prototype.getFolderName = function () {
  if (this.name === 'main') {
    return this.gameUid
  }

  return `${this.gameUid}-${this.name}`
}

/**
 * @summary Retrieve the default install path for this release
 * @returns {String} Suggested install path
 */
Release.prototype.getSuggestedInstallPath = function () {
  const {
    platform,
    buildConfig,
  } = this.modules

  let suggestedInstallPath = ''

  // Select the folder for the platform
  switch (platform) {
    case 'darwin':
      suggestedInstallPath = '/Applications'
      break
    case 'win32':
      suggestedInstallPath = path.join(require('os').homedir(), 'AppData', 'Local', 'Ankama')
      break
    case 'linux':
      suggestedInstallPath = path.join(require('os').homedir(), '.config', 'Ankama')
      break
  }

  suggestedInstallPath = path.join(suggestedInstallPath, buildConfig.name)
  suggestedInstallPath = path.join(suggestedInstallPath, this.getFolderName())

  return suggestedInstallPath
}

/*
 * @summary Run a hook specified by the configuration, if there is one.
 * @param {String} hookName - The name of the hook to execute
 * @param {Function} [callback] - Callback function
 * @returns {undefined} void
 */
Release.prototype.runHook = function (hookName, callback) {
  const {
    scriptSpawner,
    logger,
  } = this.modules

  const hooks = this.configuration.hooks || {}
  const {
    [hookName]: scriptPath,
  } = hooks

  if (!this.configuration) {
    throw new Error('Cannot execute hooks if configuration is not instantiated')
  }

  function runCallback(...args) {
    if (callback) {
      callback(...args)
    }
  }

  if (!scriptPath) {
    logger.debug('release: no hook defined in configuration, skipping', {
      release: this.name,
      gameUid: this.gameUid,
      hook: hookName,
    })

    return process.nextTick(runCallback)
  }

  try {
    const proc = scriptSpawner.spawn(this.location, scriptPath)
    proc.on('exit', (exitCode) => {
      if (exitCode > 0) {
        logger.warn('release: error while running hook', {
          release: this.name,
          gameUid: this.gameUid,
          hook: hookName,
          scriptPath: scriptPath,
          exitCode: exitCode,
        })
      }

      runCallback(exitCode)
    })
  } catch (error) {
    logger.error('release: cannot run hook', {
      release: this.name,
      gameUid: this.gameUid,
      hook: hookName,
      scriptPath: scriptPath,
      errorMessage: error.message,
      error: error.stack,
    })

    return process.nextTick(() => {
      // As we did not have any exitCode,
      // return a negative one to never conflict with script exitCode (which will be positive)
      runCallback(-1)
    })
  }
}

/**
 * It is generally easier to hold on to the process instance
 * returned by `.start()` than to try to identify which process
 * to stop in the running instance list of the release.
 *
 * @summary Stop a running instance
 * @param {Number} [pos=0] - Which instance to stop.
 * @param {String} [signal=SIGTERM] - Signal to stop the process with.
 * @returns {undefined} void
 */
Release.prototype.stop = function (pos = 0, signal = 'SIGTERM') {
  const {
    PROCESS_NOT_FOUND,
  } = errors

  const proc = this.runningInstances[pos]

  if (!proc) {
    throw new ZaapError(PROCESS_NOT_FOUND, `Process ${pos} does not exist!`)
  }

  proc.kill(signal)
  this.runHook('stop')
}

/**
 * @summary Stop all running instances of the game release
 * @param {String} [signal=SIGTERM] - Signal to stop the process with.
 * @returns {undefined} void
 */
Release.prototype.stopAll = function (signal = 'SIGTERM') {
  this.runningInstances.forEach(function (proc) {
    proc.kill(signal)
  })
  this.runHook('stop')
}

/**
 * @summary Start multiple instances in series.
 * @param {number} remainingInstancesToStart - Number of instances to start
 * @returns {Promise} When all instance launch are complete
 */
Release.prototype.startSeries = function (remainingInstancesToStart) {
  const {
    logger,
  } = this.modules

  return new Promise((resolve, reject) => {
    if (remainingInstancesToStart === 0) {
      return resolve()
    }
    const handleLaunched = () => {
      resolve(this.startSeries(remainingInstancesToStart - 1))
    }
    this.once('series-launched', handleLaunched)
    this.start()
      .catch((error) => {
        logger.error('release:', error)
        this.removeListener('series-launched', handleLaunched)
        reject(error)
      })
  })
}

/**
 * @summary Start a new instance of the game release.
 * @returns {Promise} Promise object
 */
Release.prototype.start = function () {
  const {
    logger,
    service,
    scriptSpawner,
    appSettings,
    fs,
    checkConfiguration,
    getKpi,
    DEFAULT_LAUNCHING_WAIT_IN_MS,
  } = this.modules
  const kpi = getKpi()

  const {
    NOT_INSTALLED,
    UPDATE_AVAILABLE,
    UPDATE_RUNNING,
    MAX_RUNNING_INSTANCES_REACHED,
    IS_MOVING,
  } = errors

  const {
    configuration,
  } = this

  kpi.gameLaunch()

  return new Promise((resolve, reject) => {
    if (!this.isInstalled()) {
      return reject(new ZaapError(
        NOT_INSTALLED,
        'Cannot start, release is not installed',
        'release.error.cannotStartNotInstalled'
      ))
    }

    if (this.isUpdateProcessRunning()) {
      return reject(new ZaapError(
        UPDATE_RUNNING,
        'Cannot start while the release is being updated',
        'release.error.cannotStartWhileUpdating'
      ))
    }

    if (this.isUpdateAvailable()) {
      return reject(new ZaapError(
        UPDATE_AVAILABLE,
        'Cannot start, an update is available',
        'release.error.cannotStartUpdateAvailable'
      ))
    }

    if (this.isMaxRunningInstances()) {
      return reject(new ZaapError(
        MAX_RUNNING_INSTANCES_REACHED,
        'Cannot start, max number of instances reached',
        'release.error.cannotStartMaxInstancesReached'
      ))
    }

    if (this.isMoving) {
      return reject(new ZaapError(
        IS_MOVING,
        'Cannot start, release is moving',
        'release.error.cannotStartReleaseIsMoving'
      ))
    }

    if (appSettings.fileHasBeenDeleted()) {
      return reject(new Error('release: cannot start, settings file has been deleted'))
    }

    fs.mkdirpSync(this.getLogsPath())

    checkConfiguration(this.location, this.configuration)
      .then(() => {
        // Tell the service API that we are about to start a new process instance
        const serviceInfo = service.createEnvironmentForRelease(this)

        // Start the process
        const proc = scriptSpawner.spawn(
          this.location,
          configuration.executable,
          configuration.arguments,
          serviceInfo.env
        )

        // Monitor and auto-cleanup
        proc.on('exit', (code) => {
          // Tell the service API to invalidate the credentials created
          // for this process instance
          service.invalidateCredentials(this, serviceInfo.id)

          // Check if it should restart, then remove current instance from instances to restart if needed
          const shouldRestart = this.instancesToRestart.includes(serviceInfo.id)
          this.instancesToRestart = this.instancesToRestart.filter((id) => serviceInfo.id !== id)

          logger.info('Release exited', {
            name: this.gameName,
            release: this.name,
            code: code,
            pid: proc.pid,
            instanceId: serviceInfo.id,
            shouldRestart,
          })

          this.runningInstances = this.runningInstances.filter((procInstance) => proc.pid !== procInstance.pid)
          this.isLaunching = false
          this.emit('update')

          if (shouldRestart) {
            logger.info('Restarting release...')
            this.start()
              .catch((error) => {
                logger.error('release: cannot restart', error)
              })
          } else if (this.updateOnExit && !this.isRunning()) {
            this.updateOnExit = false
            this.update()
              .catch((error) => {
                logger.error('release: cannot update', error)
              })
          }
        })

        // Add to the running instances
        this.isLaunching = true
        this.runningInstances.push(proc)
        this.saveToDisk()

        // If we do not need to wait start to start next instance,
        // unlock the launching state after DEFAULT_LAUNCHING_WAIT_IN_MS
        if (!this.configuration.waitLaunchDuringStartSeries) {
          setTimeout(() => {
            this.setIsLaunching(false)
          }, DEFAULT_LAUNCHING_WAIT_IN_MS)
        }

        resolve(proc)
      })
      .catch(reject)
  })
}

/**
 * @summary Set an instance to restart on exit
 * @param {String} [instanceId] - Instance id
 * @returns {undefined} void
 */
Release.prototype.restartOnExit = function (instanceId) {
  this.instancesToRestart.push(instanceId)
}

/**
 * @summary Update the isLaunching state and emit an update event
 * @param {boolean} value - value
 * @returns {undefined} void
 */
Release.prototype.setIsLaunching = function (value) {
  this.isLaunching = value
  this.emit('update')
  this.emit('series-launched')
}

/**
 * @summary Creates the location if it does not already exist
 * @param {String} location - Location to create (if it does not exist)
 * @returns {undefined} void
 */
Release.prototype.ensureLocationExists = function (location) {
  const {
    fs,
  } = this.modules

  const {
    LOCATION_NOT_A_DIRECTORY,
    UNKNOWN_FILE_ERROR,
  } = errors

  try {
    fs.mkdirpSync(location)
  } catch (error) {
    const msg = 'Cannot create destination folder'

    switch (error.code) {
      case 'EEXIST':
        throw new ZaapError(
          LOCATION_NOT_A_DIRECTORY,
          msg,
          'release.error.cannotCreateDestinationFolder'
        )
      default:
        throw new ZaapError(
          UNKNOWN_FILE_ERROR,
          `${msg}: ${error.message} (code: ${error.code})`,
          'release.error.cannotCreateDestinationFolder'
        )
    }
  }
}

/**
 * @summary Download and compile configuration in a temp folder
 * @param {String} version - Version of the configuration to load
 * @returns {Promise} Promise object
 */
Release.prototype.loadConfigurationInTempFolder = function (version) {
  const {
    Update,
    actionFactory,
    updateQueue,
    configuration,
    logger,
  } = this.modules


  if (this.isInstalled()) {
    return Promise.resolve()
  }

  if (!version) {
    version = this.repositoryVersion
  }

  return new Promise((resolve, reject) => {
    const up = new Update(
      Update.types.PRE_INSTALL,
      this._repository,
      this.gameUid,
      this.name,
      version,
      configuration.get(this, this.tmpLocation),
      this.tmpLocation,
      this.updatePausedByUser,
      {
        updateQueue,
        actionFactory,
        logger,
      }
    )

    up.on('error', reject)

    up.on('completed', () => {
      this.loadConfiguration(this.tmpLocation)
      resolve(this.configuration.getFragments())
    })
  })
}

/**
 * This method is part of the boilerplate for installs, updates and repairs.
 *
 * @summary Create an update instance.
 * @param {String} updateType - Type of update
 * @param {String} version - Version to target for this update process.
 * @param {Boolean} fromScratch - If the update is an installation from scratch
 * @returns {Promise} Promise object instance.
 * @private
 */
Release.prototype.createUpdate = function (updateType, version, fromScratch = false) {
  const {
    _repository: repository,
    location,
  } = this

  const {
    actionFactory,
    Update,
    updateQueue,
    logger,
    connectivity,
    getKpi,
  } = this.modules

  const {
    LOCATION_NOT_SET,
    CANNOT_UPDATE_WHILE_OFFLINE,
    IS_RUNNING,
    UPDATE_RUNNING,
    IS_MOVING,
    CYTRUS_VERSION_NOT_HANDLED,
  } = errors

  if (!location) {
    return Promise.reject(new ZaapError(
      LOCATION_NOT_SET,
      'Trying to create an update process but no location is specified',
      'release.error.cannotUpdateNoLocation'
    ))
  }

  if (!connectivity.isOnline) {
    return Promise.reject(new ZaapError(
      CANNOT_UPDATE_WHILE_OFFLINE,
      'Cannot update while offline',
      'release.error.cannotUpdateOffline'
    ))
  }

  if (this.isRunning()) {
    return Promise.reject(new ZaapError(
      IS_RUNNING,
      'Cannot update, this game release has some running instances',
      'release.error.cannotUpdateGameIsRunning'
    ))
  }
  if (this.isUpdateProcessRunning()) {
    return Promise.reject(new ZaapError(
      UPDATE_RUNNING,
      'Cannot update, an update is already running',
      'release.error.cannotUpdateAlreadyRunning'
    ))
  }

  if (this.isMoving) {
    return Promise.reject(new ZaapError(
      IS_MOVING,
      'Cannot update, release is moving',
      'release.error.cannotUpdateReleaseIsMoving'
    ))
  }

  if (!this.isGameVersionHandledByCytrus(version)) {
    return Promise.reject(new ZaapError(
      CYTRUS_VERSION_NOT_HANDLED,
      'Release version is not following the cytrus version',
      'release.error.cannotUpdateCytrusVersionNotHandled'
    ))
  }

  return this.loadConfigurationInTempFolder(version)
    .then(() => {
      this.configuration.setPath(this.location)

      const up = new Update(
        updateType,
        repository,
        this.gameUid,
        this.name,
        version,
        this.configuration,
        location,
        this.updatePausedByUser,
        {
          updateQueue,
          actionFactory,
          logger,
          fromScratch,
        }
      )

      if (this.updateDownloadedSizeDate &&
        Date.now() - this.updateDownloadedSizeDate < UPDATE_DOWNLOADED_SIZE_LIFETIME_IN_MS) {
        up.alreadyDownloadedSize = this.updateDownloadedSize
      }
      this.updatePausedByUser = false
      this.isOpenedByExternalProcess = false

      // save download progress to disk while updating
      // But we do not want spam the front with useless updates
      const saveToDiskIntervalId = setInterval(() => {
        this.saveToDisk(false)
      }, 1000)

      const cleanup = () => {
        this.isInstalling = false
        this.isUpdating = false
        this.isRepairing = false
        this.currentUpdate = false
        this.updateDownloadedSize = 0
        this.updateDownloadedSizeDate = 0
        clearInterval(saveToDiskIntervalId)
        this.saveToDisk()
      }

      if (this.isUpdating || this.isRepairing) {
        // this check must be done as this method can be called even if there is no real update to start
        this.runHook('pre_update')
      }

      up.on('cancel', () => {
        this.isDirty = true
        cleanup()
      })

      up.on('error', (error) => {
        this.isOpenedByExternalProcess = error.code === 'EBUSY'
        this.isDirty = true
        // forget the location if the installation fails
        if (this.currentUpdate.type === Update.types.INSTALL) {
          this.forgetLocation()
        }
        cleanup()
        logger.error('Update process failed:', error)
        if (['LocalHashesError'].includes(error.name)) {
          this.repair()
            .catch((error) => {
              logger.error('release: cannot repair', error)
            })
        }
      })

      up.on('progress', (progressInfo) => {
        this.updateDownloadedSize = progressInfo.overallDownloadProgress.downloadedSize
        this.updateDownloadedSizeDate = Date.now()
      })

      up.on('completed', () => {
        let count = 0
        Object.keys(up.downloadedHashes).forEach((key) => {
          count += Object.keys(up.downloadedHashes[key].files).length
        })
        getKpi().gameUpdateEnd({
          gameId: this.gameId,
          releaseName: this.name,
          autoUpdate: this.settings.get().autoUpdate,
          downloadSpeed: Math.floor(up.averageSpeed / 1024),
          updateSize: Math.floor(this.updateDownloadedSize / 1024),
          updateFiles: count,
        })

        this.isDirty = false
        this.installedFragments = this.configuration.fragments
        this.version = version
        this.licenses = licenses.create(this.configuration.licensesFolder, this.location, this._filepath)
        cleanup()
        this.runHook('post_update')
      })

      this.currentUpdate = up
      this.saveToDisk()

      return up
    })
}

/**
 * @summary Check if cytrus can handle this game version
 * @param {String} version - game version
 * @returns {Boolean} can handle
 */
Release.prototype.isGameVersionHandledByCytrus = function (version) {
  const {
    CYTRUS_VERSION,
  } = this.modules
  return version.startsWith(CYTRUS_VERSION)
}

/**
 * @summary Cancel the current update
 * @returns {undefined} void
 */
Release.prototype.cancelCurrentUpdate = function () {
  const {
    logger,
  } = this.modules

  if (!this.isUpdateProcessRunning()) {
    logger.debug('release: cannot cancel update, no current update.')
    return
  }

  this.currentUpdate.stop()

  this.currentUpdate = null
}

/**
 * @summary Restart update
 * @returns {Promise} Promise object
 */
Release.prototype.restartUpdate = function () {
  const currentDownloadedSize = this.updateDownloadedSize
  this.cancelCurrentUpdate()
  this.updateDownloadedSize = currentDownloadedSize
  return this.update()
}

/**
 * @summary Restart install
 * @returns {Promise} Promise Object
 */
Release.prototype.restartInstall = function () {
  const currentDownloadedSize = this.updateDownloadedSize

  // set updatePausedByUser that will be handled by createUpdate
  this.updatePausedByUser = this.currentUpdate.isPausedByUser

  this.cancelCurrentUpdate()
  this.updateDownloadedSize = currentDownloadedSize

  return this.repair()
}

/**
 * Installs are working exactly the same way as updates.
 * We only do a quick sanity check to confirm that the location
 * is accessible and load empty configuration and settings objects.
 *
 * @summary Install the release at the given location.
 * @param {string} location - Where to install the game on disk.
 * @param {boolean} fromScratch - If the installation is not a continuation of a previous install
 * @returns {Promise} void
 */
Release.prototype.install = function (location, fromScratch = false) {
  const {
    buildConfig,
    platform,
    Update,
    pathHelper,
    disk,
    getKpi,
  } = this.modules
  const kpi = getKpi()

  const {
    repositoryVersion,
  } = this

  const {
    NOT_ENOUGH_SPACE,
    USER_PERMISSIONS,
  } = errors

  let sec30Timer

  return Promise.all([
    this.getInstallationSize(),
    disk.getDriveInfo(location),
  ]).then(([installationSize, driveInfo]) => {
    if (installationSize >= driveInfo.free) {
      throw new ZaapError(
        NOT_ENOUGH_SPACE,
        'Cannot install, not enough space!',
        'release.error.cannotInstallNotEnoughSpace'
      )
    }

    this.ensureLocationExists(location)

    pathHelper.checkIfLocationIsInstallable(location, this.gameUid, this.name)

    if (!pathHelper.hasReadWritePermissions(location)) {
      throw new ZaapError(
        USER_PERMISSIONS,
        'Cannot install, write not allowed!',
        'release.error.cannotInstallReadWritePermissions'
      )
    }

    kpi.gameInstallStart()

    sec30Timer = setTimeout(() => {
      if (this.currentUpdate.isRunning) {
        kpi.gameInstallSec30(this.currentUpdate.averageSpeed)
      }
    }, exports.GAME_INSTALL_SEC_30_MS)

    this.isInstalling = true
    this.location = location
    this.loadLocation()

    const sameRelease = pathHelper.isLocationTheSameRelease(location, this.gameUid, this.name)
    let updateType
    if (sameRelease) {
      updateType = Update.types.REPAIR
      fromScratch = false
    } else {
      updateType = Update.types.INSTALL
    }

    return this.createUpdate(updateType, repositoryVersion, fromScratch)
  }).then(() => {
    this.currentUpdate.on('completed', () => {
      clearTimeout(sec30Timer)
      kpi.gameInstallEnd(this.currentUpdate.averageSpeed)

      if (platform === 'win32' && buildConfig.isBuild) {
        this.createShortcut()
      }
    })
  })
}

/**
 * Move the release to another folder.
 *
 * @summary Move the release to another folder.
 * @param {string} location - Where to move the game on disk.
 * @param {boolean} skipLocationIsInstallableChecks - skip the locationIsInstallable checks
 * @returns {Promise} Promise Object
 */
Release.prototype.move = function (location, skipLocationIsInstallableChecks = false) {
  const {
    IS_MOVING,
    SAME_FOLDER,
    NOT_INSTALLED,
    USER_PERMISSIONS,
    UPDATE_RUNNING,
    IS_RUNNING,
  } = errors

  const {
    recursive,
    fs,
    logger,
    disk,
    getFolderSize,
    pathHelper,
  } = this.modules

  return new Promise((resolve, reject) => {
    if (!this.isInstalled()) {
      return reject(new ZaapError(
        NOT_INSTALLED,
        'Cannot move, not installed!',
        'release.error.cannotMoveNotInstalled'
      ))
    }

    if (this.isMoving) {
      return reject(new ZaapError(
        IS_MOVING,
        'Cannot move, this release is already moving',
        'release.error.cannotMoveWhileMoving'
      ))
    }

    if (location === this.location) {
      return reject(new ZaapError(
        SAME_FOLDER,
        'Cannot move, target location is the same than current location',
        'release.error.cannotMoveSameFolder'
      ))
    }

    if (this.isUpdateProcessRunning()) {
      return reject(new ZaapError(
        UPDATE_RUNNING,
        'Cannot move while the release is being updated',
        'release.error.cannotMoveWhileUpdating'
      ))
    }

    if (this.isRunning()) {
      return reject(new ZaapError(
        IS_RUNNING,
        'Cannot move, this release has some running instances',
        'release.error.cannotMoveWhileRunning'
      ))
    }

    // check write permissions
    if (!pathHelper.hasReadWritePermissions(location)) {
      return reject(new ZaapError(
        USER_PERMISSIONS,
        'Cannot move, write not allowed!',
        'release.error.cannotMoveReadWritePermissions'
      ))
    }

    this.ensureLocationExists(location)

    if (!skipLocationIsInstallableChecks) {
      try {
        pathHelper.checkIfLocationIsInstallable(location, this.gameUid, this.name)
      } catch (error) {
        reject(error)
      }
    }

    // check disk space
    Promise.all([
      disk.getDriveInfo(location),
      disk.getDriveInfo(this.location),
    ])
      .then(([destinationInfo, originInfo]) => {
        if (originInfo.diskPath === destinationInfo.diskPath) {
          recursive(this.location, (error, files) => {
            if (error) {
              logger.error('release: cannot move, recursive failed', error)
              return reject(error)
            }

            let maxFileSize = 0
            files.forEach((filePath) => {
              maxFileSize = Math.max(maxFileSize, fs.statSync(filePath).size)
            })

            this.moveIfEnoughSpace(
              location,
              originInfo.free,
              maxFileSize,
              resolve,
              reject)
          })
        } else {
          getFolderSize(this.location)
            .then((size) => {
              this.moveIfEnoughSpace(
                location,
                destinationInfo.free,
                size,
                resolve,
                reject)
            })
            .catch((error) => {
              logger.error('release: cannot move, getFolderSize failed', error)
              return reject(error)
            })
        }
      })
      .catch((error) => {
        logger.error('release: cannot move', error)
        reject(error)
      })
  })
}

/**
 * @summary Execute the move process if there is enough space on the disk
 * @param {String} location - the new location
 * @param {Number} freeSpace - the free space on the disk
 * @param {Number} minimumSpace - the minimum space that must be free on the disk
 * @param {Function} resolve - the resolve function of the promise
 * @param {Function} reject - the reject function of the promise
 * @return {undefined} void
 */
Release.prototype.moveIfEnoughSpace = function (location, freeSpace, minimumSpace, resolve, reject) {
  const {
    NOT_ENOUGH_SPACE,
  } = errors

  if (freeSpace < minimumSpace) {
    reject(new ZaapError(
      NOT_ENOUGH_SPACE,
      'Cannot move, not enough space!',
      'release.error.cannotMoveNotEnoughSpace'
    ))
  } else {
    this.moveExecution(location, resolve, reject)
  }
}

/**
 * @summary Execute the move process.
 * @param {String} location - the new location
 * @param {Function} resolve - the resolve function of the promise
 * @param {Function} reject - the reject function of the promise
 * @returns {undefined} void
 */
Release.prototype.moveExecution = function (location, resolve, reject) {
  const {
    fs,
    logger,
  } = this.modules

  this.isMoving = location
  this.saveToDisk()

  fs.move(this.location, location, {
    overwrite: true,
  }, (err) => {
    this.isMoving = false

    if (err) {
      logger.error('release: cannot move', err)
      return reject(err)
    }

    fs.unwatchFile(this.location)
    this.setConfiguration(null)

    this.location = location
    this.loadLocation()
    this.saveToDisk()

    resolve()
  })
}

/**
 * Updates should run when the target version is the same as
 * the current version, but the list of fragments has been modified;
 * this basically may happen upon configuration changes triggered by
 * changing settings.
 *
 * A common example of this would be with language fragments: language
 * to use for a game may be configurable through settings, and upon
 * settings changes, the configuration will recompile and likely
 * present us with a new list of required fragments for the game (essentially
 * we will need to download old language fragment(s) and download the new ones).
 *
 * @summary Update the game release.
 * @returns {Promise} Promise object
 */
Release.prototype.update = function () {
  const {
    repositoryVersion,
  } = this

  const {
    Update,
    getKpi,
  } = this.modules

  this.isUpdating = true

  getKpi().gameUpdateStart({
    gameId: this.gameId,
    releaseName: this.name,
    autoUpdate: this.settings.get().autoUpdate,
  })

  return this.createUpdate(Update.types.UPDATE, repositoryVersion)
}

/**
 * @summary Restart repair
 * @returns {Promise} Promise object
 */
Release.prototype.restartRepair = function () {
  const currentDownloadedSize = this.updateDownloadedSize
  this.cancelCurrentUpdate()
  this.updateDownloadedSize = currentDownloadedSize
  return this.repair()
}

/**
 * Repairs may run at any time. Basically, this will
 * make sure that our game file list is up-to-date,
 * run a checksum on every local files, and re-download
 * any file who have a different checksum.
 *
 * @summary Repair the game release.
 * @returns {Promise} Promise object.
 */
Release.prototype.repair = function () {
  const {
    repositoryVersion,
  } = this

  const {
    Update,
  } = this.modules

  this.isRepairing = true
  return this.createUpdate(Update.types.REPAIR, repositoryVersion)
}

/**
 * @summary Clean release state after uninstall
 * @param {Boolean} shouldSendKpiUninstall - Will send KPI uninstall data if set to true
 * @returns {undefined}
 */
Release.prototype.cleanAfterUninstall = function (shouldSendKpiUninstall) {
  const {
    buildConfig,
    platform,
    getKpi,
  } = this.modules
  const kpi = getKpi()

  if (shouldSendKpiUninstall) {
    kpi.gameUninstall()
  }

  if (platform === 'win32' && buildConfig.isBuild) {
    this.deleteShortcut()
  }

  this.forgetLocation()
  this.setSettings(false)
  this.setConfiguration(false)

  this.isInstalling = false
  this.isUpdating = false
  this.isRepairing = false
  this.isDirty = false

  this.version = false
  this.updateDownloadedSize = 0
  this.updateDownloadedSizeDate = 0

  this.saveToDisk()
}

/**
 * @summary Remove the game from its location.
 * @returns {Promise} Release is uninstalled or error
 */
Release.prototype.uninstall = function () {
  const {
    logger,
    fs,
    getKpi,
    update,
  } = this.modules
  const kpi = getKpi()

  const {
    NOT_INSTALLED,
    IS_RUNNING,
  } = errors

  let shouldSendKpiUninstall = true
  this.isOpenedByExternalProcess = false

  return new Promise((resolve, reject) => {
    if (this.isUpdateProcessRunning()) {
      this.cancelCurrentUpdate()
      shouldSendKpiUninstall = false
      if (this.currentUpdate && this.currentUpdate.type === update.types.UPDATE) {
        kpi.gameUpdateCancel({
          gameId: this.gameId,
          releaseName: this.name,
          autoUpdate: this.settings.get().autoUpdate,
        })
      } else {
        kpi.gameInstallCancel()
      }
    } else if (!this.isInstalled()) {
      return reject(
        new ZaapError(
          NOT_INSTALLED,
          'Cannot uninstall, this game is not installed',
          'release.error.cannotUninstallNotInstalled'
        )
      )
    } else if (this.isRunning()) {
      return reject(
        new ZaapError(
          IS_RUNNING,
          'Cannot uninstall, this game release has some running instances',
          'release.error.cannotUninstallWhileRunning'
        )
      )
    }

    // Schedule deletion
    logger.info('Uninstalling', {
      gameUid: this.gameUid,
      release: this.name,
      location: this.location,
    })

    // Catch case when the location is to false,
    // but not coherent with release global state
    if (!this.location) {
      this.cleanAfterUninstall(shouldSendKpiUninstall)
      return resolve()
    }

    fs.remove(this.location)
      .then(() => {
        logger.info('All local files have been deleted', {
          gameUid: this.gameUid,
          release: this.name,
        })

        this.cleanAfterUninstall(shouldSendKpiUninstall)

        resolve()
      })
      .catch((error) => {
        logger.error('Failed to delete directory while uninstalling', {
          gameUid: this.gameUid,
          release: this.name,
          error: error,
        })

        if (error.code === 'EBUSY') {
          this.isOpenedByExternalProcess = true
          this.emit('update')
        }
        reject(error)
      })
  })
}

/**
 * @summary Get FullName
 * @returns {String} the full name
 */
Release.prototype.getFullName = function () {
  return (this.gameName + ' ' + this.information.default.displayName).trim()
}

/**
 * @summary Create shortcut
 * @returns {undefined} void
 */
Release.prototype.createShortcut = function () {
  const {
    logger,
    shortcut,
    releaseIpcManager,
  } = this.modules

  try {
    shortcut.create(
      this.getFullName(),
      process.execPath,
      `${releaseIpcManager.GAMEUID_ARG}${this.gameUid} ${releaseIpcManager.RELEASE_ARG}${this.name}`,
      path.join(this.information.url, 'shortcut.ico')
    )
  } catch (error) {
    logger.error('release: cannot create shortcut', error)
  }
}

/**
 * @summary Delete shortcut
 * @returns {undefined} void
 */
Release.prototype.deleteShortcut = function () {
  const {
    logger,
    shortcut,
  } = this.modules

  try {
    shortcut.delete(this.getFullName())
  } catch (error) {
    logger.warn('release: was not able to delete shortcut', error)
  }
}

/**
 * @summary Create a light object that can be used by the renderer process.
 * @returns {Object} The light object
 */
Release.prototype.expose = function () {
  const lightObject = {
    gameUid: this.gameUid,
    gameId: this.gameId,
    gameOrder: this.gameOrder,
    gameName: this.gameName,
    name: this.name,
    order: this.order,
    fullName: this.getFullName(),
    folderName: this.getFolderName(),
    location: this.location,
    runningInstances: Array.from(this.runningInstances, x => x.pid),
    information: this.information,
    settings: this.settings ?
      {
        configuration: this.settings.getConfiguration(),
        values: this.settings.get(),
      }
      : false,
    isInstalled: this.isInstalled(),
    isInstalling: this.isInstalling,
    isMoving: !!this.isMoving,
    isUpdateProcessRunning: this.isUpdateProcessRunning(),
    isUpdateAvailable: this.isUpdateAvailable(),
    isLaunching: this.isLaunching,
    isMaxRunningInstances: this.isMaxRunningInstances(),
    isOpenedByExternalProcess: this.isOpenedByExternalProcess,
    news: this.news,
    ratings: ratings.get(this.information.default),
    hasLicenses: this.isInstalled() && !!this.configuration.licensesFolder,
    version: this.version,
  }

  if (this.currentUpdate) {
    lightObject.currentUpdate = this.currentUpdate.expose()
  }

  return lightObject
}

/**
 * Compute the size of the installation
 * @summary Compute the size of the installation
 * @param {String} [version] - Version to compute installation size.
 * @returns {Promise} Promise object
 */
Release.prototype.getInstallationSize = function (version = this.repositoryVersion) {
  return Promise.all([
    this.loadConfigurationInTempFolder(version),
    this._repository.getReleaseMeta(this.gameUid, this.name, PLATFORM, version),
  ]).then(([fragments, releaseMeta]) => {
    if (fragments.indexOf('configuration') === -1) {
      fragments = ['configuration', ...fragments]
    }
    return fragments.reduce(
      (size, fragment) => size + releaseMeta[fragment].totalSize, 0
    )
  })
}
