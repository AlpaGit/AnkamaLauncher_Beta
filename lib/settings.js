/**
 * App-level settings
 *
 * @module zaap/settings
 */
const electronSettingsEvents = require('electron-settings/lib/settings').Events
const inject = require('instill')
const logger = require('./logger')
const remoteCommunication = require('./remoteCommunication')

inject(exports, {
  getSettings: () => require('electron-settings'),
  getApp: () => require('./app'),
  packageInfo: require('../package.json'),
  ipcMain: require('electron').ipcMain,
})

/**
 * Enum which contains settings keys
 * @type {Object}
 */
const KEYS = exports.KEYS = {}
const keyList = [
  // Displayed settings
  'LANGUAGE',
  'AUTO_LAUNCH',
  'STAY_LOGGED_IN',
  'AT_CLOSE',
  'AT_MINIMIZE',
  'MINIMIZE_AT_RELEASE_LAUNCH',
  'PRE_RELEASE',

  // Technical settings
  'ACCEPTED_TERMS_VERSION',
  'LAST_AUTHENTICATED_ACCOUNT_ID',
  'LAST_AUTHENTICATED_LOGIN',
  'USER_INFO',
  'FIRST_LAUNCH',
  'WINDOWS_STATE',
  'LAST_OPENED_RELEASE',
  'DEVICE_UID',
]
keyList.forEach(function (key) {
  KEYS[key] = key
})
exports.GAME_DEPENDENT_KEYS = [
  KEYS.LANGUAGE,
]

const SCHEMA_VERSION_KEY = '_schemaVersion'
exports.CURRENT_SCHEMA_VERSION = 2

exports.isSetup = false

// Set startup defaults
let defaults = {
  // Displayed settings
  [KEYS.AUTO_LAUNCH]: true,
  [KEYS.LANGUAGE]: 'en', // Will be updated with the OS language in setup()
  [KEYS.AT_CLOSE]: 'tray',
  [KEYS.AT_MINIMIZE]: 'taskbar',
  [KEYS.MINIMIZE_AT_RELEASE_LAUNCH]: false,
  [KEYS.PRE_RELEASE]: false,

  // Technical settings
  [KEYS.FIRST_LAUNCH]: true,
}

/**
 * Setting up settings will start watch and sync them
 *
 * @summary Set up settings
 * @returns {Object} settings
 */
exports.setup = function () {
  const {
    getApp,
    packageInfo,
    getSettings,
    ipcMain,
  } = this.modules

  const settings = getSettings()
  const app = getApp()

  if (this.isSetup) {
    logger.info('settings: already setup')
    return this
  }

  this.isSetup = true

  this.migrate()

  /**
   * Expose supported/default languages
   */
  exports.supportedLanguages = packageInfo.supportedLanguages
  exports.defaultLanguage = packageInfo.defaultLanguage
  defaults[KEYS.LANGUAGE] = app.getLocale().substring(0, 2)

  /**
   * Setup defaults
   */
  exports.updateDefaults(defaults)

  /**
   * Sync up all changes
   */
  settings.watch('', () => {
    remoteCommunication.send(remoteCommunication.CHANNELS.ZAAP_SETTINGS_UPDATED, this.get())
  })

  ipcMain.on(remoteCommunication.CHANNELS.ZAAP_SETTINGS_GET, (event) => {
    event.returnValue = this.get()
  })

  ipcMain.on(remoteCommunication.CHANNELS.ZAAP_SETTINGS_SET, (event, key, value) => {
    this.set(key, value)
  })

  /**
   * Language must be set to something valid.
   */
  settings.watch(KEYS.LANGUAGE, () => {
    const value = this.get(KEYS.LANGUAGE)
    if (!exports.supportedLanguages.includes(value)) {
      throw new Error(`Unsupported language: ${value}`)
    }
  })

  /**
   * Set schema version
   */
  settings.set(SCHEMA_VERSION_KEY, this.CURRENT_SCHEMA_VERSION)

  return this
}

/**
 * Allow moving settings depending on environment
 *
 * @summary Expose electron-settings setPath.
 * @param {object} path - Settings path.
 * @returns {undefined} void
 */
exports.setPath = function (path) {
  const {
    getSettings,
  } = this.modules

  const settings = getSettings()

  settings.setPath(path)
}

/**
 * You may want to use this to inject default values
 * into the settings system.
 *
 * @summary Update the default values.
 * @param {object} newDefaults - Default values to use.
 * @returns {undefined} void
 */
exports.updateDefaults = function (newDefaults) {
  // Manage default language
  if (!newDefaults.hasOwnProperty(KEYS.LANGUAGE)) {
    newDefaults[KEYS.LANGUAGE] = exports.defaultLanguage
  } else {
    const isSupportedLanguage = exports.supportedLanguages.includes(newDefaults[KEYS.LANGUAGE])
    if (!isSupportedLanguage) {
      newDefaults[KEYS.LANGUAGE] = exports.defaultLanguage
    }
  }

  defaults = newDefaults
}

/**
 * @summary Set configuration.
 * @param {string} key - Key (ex: 'user.name')
 * @param {*} value - Value to set. Can be an object.
 * @returns {undefined} void
 */
exports.set = function (key, value) {
  const {
    getSettings,
  } = this.modules

  const settings = getSettings()

  if (key === SCHEMA_VERSION_KEY) {
    throw new Error(SCHEMA_VERSION_KEY + ' is a internal protected key')
  }

  settings.set(key, value)
  settings.emit(electronSettingsEvents.CHANGE)
}

/**
 * @summary Get a configuration value.
 * @param {String|undefined} key - Key (ex: 'user.name')
 * @returns {*} - configuration value
 */
exports.get = function (key = undefined) {
  const {
    getSettings,
  } = this.modules

  const settings = getSettings()

  if (key === null || key === undefined || key.length === 0) {
    let value = settings.getAll()
    return Object.assign({}, defaults, value)
  }

  return settings.get(key, defaults[key])
}

/**
 * @summary Delete a configuration value.
 * @param {string} key - Key (ex: 'user.name')
 * @returns {undefined} void
 */
exports.delete = function (key) {
  const {
    getSettings,
  } = this.modules

  const settings = getSettings()

  if (key === SCHEMA_VERSION_KEY) {
    throw new Error(SCHEMA_VERSION_KEY + ' is a internal protected key')
  }

  settings.delete(key)
}

/**
 * The callback function will receive two arguments like the following:
 *
 *     newValue, oldValue
 *
 * `oldValue` will be undefined when the value is created, and `newValue`
 * will be undefined when it is deleted.
 *
 * @summary Get a configuration value.
 * @param {string} key - Key (ex: 'user.name')
 * @param {settings~observeCallback} callback - callback function to call when a key is modified.
 * @returns {Observer} void
 */
exports.watch = function (key, callback) {
  const {
    getSettings,
  } = this.modules

  const settings = getSettings()

  /**
   * @callback settings~observeCallback
   * @param {*} oldValue - old value
   * @param {*} newValue - new value
   */
  return settings.watch(key, callback)
}

/**
 * @summary Revert configuration to default.
 * @returns {undefined} void
 */
exports.reset = function () {
  const {
    getSettings,
  } = this.modules

  const settings = getSettings()

  settings.setAll(defaults)

  /**
   * Set schema version
   */
  settings.set(SCHEMA_VERSION_KEY, this.CURRENT_SCHEMA_VERSION)
}

/**
 * @summary Returns true if the settings file has been deleted
 * @returns {boolean} true if the settings file has been deleted
 */
exports.fileHasBeenDeleted = function () {
  const userInfo = this.get(KEYS.USER_INFO)
  if (typeof userInfo === 'undefined') {
    // if the Settings file has been deleted, the userInfo will be undefined.
    // this line will force the settings to dispatch the changes
    // and the user will be logout (see setup in auth)
    this.set(KEYS.USER_INFO, userInfo)
    return true
  }

  return false
}

exports.migrate = function () {
  const {
    getSettings,
  } = this.modules

  const settings = getSettings()

  const OLD_KEYS = {
    WINDOWS_BOUNDS: 'WINDOWS_BOUNDS',
  }

  const savedVersion = settings.get(SCHEMA_VERSION_KEY)
  if (savedVersion === this.CURRENT_SCHEMA_VERSION) {
    return
  }

  if (savedVersion === 1) {
    this.delete(OLD_KEYS.WINDOWS_BOUNDS)
  }

  settings.set(SCHEMA_VERSION_KEY, this.CURRENT_SCHEMA_VERSION)
}
