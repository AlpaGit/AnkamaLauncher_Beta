/**
 * The configuration module takes care of loading and compiling each
 * game's configurations.
 *
 * Configurations are compiled using zaap settings, game settings and
 * other system-related variables; they also define the settings, meaning
 * that whenever settings configuration change, the settings themselves
 * will be updated.
 *
 * @module zaap/games/configuration
 */
const os = require('os')
const util = require('util')
const path = require('path')
const deepCopy = require('deep-copy')
const deepEqual = require('deep-equal')
const inject = require('instill')
const proxy = require('munchausen')
const EventEmitter = require('events')
const helpers = require('./helpers')
const settings = require('./settings')

inject(exports, {
  logger: require('../logger'),
  zaapSettings: require('../settings'),
  fs: require('fs'),
})

const CONFIG_FILE_NAME = 'zaap.yml'
const MAX_CONFIGURATION_COMPILE_ITERATION = 5
const DEFAULT_CONFIGURATION = {
  executable: 'zaap-start',
  arguments: [],
  fragments: ['main'],
  maxInstances: 1,
  hooks: {},
  settings: [],
  checkConfiguration: false,
  licensesFolder: false,
  waitLaunchDuringStartSeries: false,
}

/**
 * The created Configuration instance will be wrapped in a Proxy
 * instance to make usage simpler.
 *
 * @summary Create a new Configuration instance
 * @param {Release} release - The release the configuration relates to.
 * @param {string} filepath - Where to read/write files from/to.
 * @returns {Proxy} - Proxied release configuration object.
 */
exports.get = function (release, filepath) {
  const configuration = new Configuration(release, filepath, this.modules)
  return proxy(configuration, '_config')
}

/**
 * @summary Game configuration object
 * @param {Release} release - The release the configuration relates to.
 * @param {string} filepath - Where to read/write files from/to.
 * @param {Object} [modules] - Injected modules to use.
 *
 * @public
 * @constructor
 */
const Configuration = function (release, filepath, modules = exports.modules) {
  Object.defineProperty(this, 'modules', {
    value: modules,
    enumerable: false,
  })
  const {
    fs,
    zaapSettings,
  } = this.modules

  fs.accessSync(filepath)

  this._compiling = false
  this.release = release
  this._filepath = path.resolve(filepath)
  this._configString = ''
  this._config = {}
  this.prevFragments = null

  // Watch for zaap settings events and game release settings events
  this.zaapSettingObservers = []
  zaapSettings.GAME_DEPENDENT_KEYS.forEach(key => {
    this.zaapSettingObservers.push(zaapSettings.watch(key, this.compile.bind(this)))
  })

  // Start listening to settings update events again
  this._settingsChangedCallback = this.settingsChangedCallback.bind(this)
  this.release.addListener('settings_changed', this._settingsChangedCallback)
}

util.inherits(Configuration, EventEmitter)

/**
 * @param {string} filepath - Where to read/write files from/to.
 * @return {undefined} void
 */
Configuration.prototype.setPath = function (filepath) {
  this._filepath = path.resolve(filepath)
}

/**
 * @return {Array} - Fragments
 */
Configuration.prototype.getFragments = function () {
  return this._config.fragments
}

/**
 * Remove the event listeners.
 * This method must be called before unreferencing the configuration.
 * @return {undefined} void
 */
Configuration.prototype.removeEventListeners = function () {
  this.zaapSettingObservers.forEach((observer) => {
    observer.dispose()
  })
  this.release.removeListener('settings_changed', this._settingsChangedCallback)
}

/**
 * Callback called when the settings has changed.
 * @return {undefined} void
 */
Configuration.prototype.settingsChangedCallback = function () {
  // don't compile the configuration if it's already compiling
  if (!this._compiling) {
    this.compile()
  }
}
/**
 * Loading the configuration will automatically trigger a recompile
 *
 * @summary Load the configuration from disk
 * @returns {undefined} void
 */
Configuration.prototype.load = function () {
  const {
    logger,
    fs,
  } = this.modules

  try {
    const configFile = path.join(this._filepath, CONFIG_FILE_NAME)
    this._configString = fs.readFileSync(configFile).toString()
  } catch (error) {
    logger.warn('Could not load game configuration:', error.message)
    this._configString = ''
  }

  this.compile()
}

/**
 * @summary Retrieve the environment data which is used at compile-time.
 * @returns {Object} Configuration context.
 */
Configuration.prototype.getConfigurationContext = function () {
  const {
    zaapSettings,
  } = this.modules

  const release = this.release

  const osData = {
    platform: helpers.getRepositoryPlatform(),
    arch: os.arch(),
    release: os.release(),
    cores: os.cpus().length,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
  }

  return {
    os: osData,
    zaap: zaapSettings.get(),
    game: {
      location: release.location,
      settings: !!release.settings && release.settings.get(),
    },
  }
}

/**
 * The error object is passed to be logged
 *
 * @summary Mark configuration compilation as failed
 * @param {Error} error - Error which trigged the failure
 * @returns {Error} The same error received in parameters
 */
Configuration.prototype.markCompilationAsFailed = function (error) {
  const {
    logger,
  } = this.modules

  logger.error('Configuration compilation failed, marking as broken', {
    gameName: this.release.gameName,
    release: this.release.name,
    error: error.stack,
  })

  // Then, marked compilation as completed, and the
  // parent release as dirty. At this point, the parent
  // release is expected to either retry compilation,
  // attempt a repair, or wait for an update to become available
  this._compiling = false

  // We create a synthetic configuration, which indicates
  // the real configuration is broken
  this._config.isBroken = true

  this.emit('update', this)

  return error
}

/**
 * Note that compilation is a recursive process. Since we do not have any mean
 * of detecting variable-induced recursion, we manually limit the number of compile cycles.
 *
 * Recursion loop should only be possible using settings to set default settings values.
 *
 * @summary Compile the configuration file.
 * @returns {undefined} void
 */
Configuration.prototype.compile = function () {
  const yaml = require('js-yaml')
  const nunjucks = require('nunjucks-no-watch')
  const {
    logger,
  } = this.modules

  let iterationCount = 0
  let currentConfigString = 'current'
  let newConfigString = 'new'
  let newConfig

  // We are now compiling
  this._compiling = true

  // If no config string, we're done here
  if (!this._configString) {
    if (this.release.settings) {
      this.release.settings.updateAvailableSettings([])
    }
    this._config = Object.assign({}, DEFAULT_CONFIGURATION)
    this._compiling = false
    logger.info('No configuration defined, using default', this._config)
    return
  }

  const loader = new nunjucks.FileSystemLoader(this._filepath)
  const env = new nunjucks.Environment(loader)

  logger.debug('Compiling configuration', {
    template: this._configString,
  })

  // Compile loop
  if (!this.release.settings) {
    this.release.setSettings(settings.get(path.dirname(this._filepath), this.release.name))
  }

  while (newConfigString !== currentConfigString) {
    iterationCount += 1

    if (iterationCount > MAX_CONFIGURATION_COMPILE_ITERATION) {
      throw this.markCompilationAsFailed(new Error('Compile iteration count exceeded.'))
    }

    logger.debug('Compiling configuration, iteration', iterationCount)
    currentConfigString = newConfigString

    // Compile

    const template = new nunjucks.Template(this._configString, env)
    const context = this.getConfigurationContext()

    try {
      logger.debug('Compiling configuration using context', context)
      newConfigString = template.render(context)
      newConfig = yaml.safeLoad(newConfigString)
    } catch (error) {
      // We first log the origin of the error, and the error itself
      throw this.markCompilationAsFailed(error)
    }

    // Apply new settings
    this.release.settings.updateAvailableSettings(newConfig.settings || [])
  }

  // Compiling is over
  this._compiling = false

  // Apply defaults
  const oldConfig = deepCopy(this._config)

  // Save previous fragments
  this.prevFragments = this._config.fragments && this._config.fragments.filter(frag => frag !== 'configuration')

  this._config = Object.assign({}, DEFAULT_CONFIGURATION, newConfig)
  logger.debug('New configuration', this._config)

  if (!deepEqual(oldConfig, this._config)) {
    this.emit('update', this)
  }
}
