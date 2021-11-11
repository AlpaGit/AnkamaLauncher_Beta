/**
 * Game settings contains:
 *
 *   1. All the options configurable by the end-user.
 *   2. Default values for each options
 *   3. Display information (what visual component to use, etc)
 *
 * Game settings are defined by the game configuration: when the configuration
 * is modified, it will send back the configuration segment pertaining to settings.
 *
 * @summary Game settings.
 * @module zaap/games/settings
 */
const deepEqual = require('deep-equal')
const path = require('path')
const inject = require('instill')
const proxy = require('munchausen')
const util = require('util')
const EventEmitter = require('events')
const logger = require('../logger')

inject(exports, {
  fs: require('fs'),
})

const SETTINGS_FILE_NAME = 'settings.json'

const KEYS = {
  AUTO_UPDATE: 'autoUpdate',
  DISPLAY_ALL_RELEASES: 'displayAllReleases',
}
exports.KEYS = KEYS

const COMMON_SETTINGS = {
  [KEYS.AUTO_UPDATE]: {
    order: 1000,
    name: KEYS.AUTO_UPDATE,
    default: true,
    type: 'checkbox',
  },
  [KEYS.DISPLAY_ALL_RELEASES]: {
    order: 1010,
    name: KEYS.DISPLAY_ALL_RELEASES,
    default: false,
    type: 'checkbox',
  },
}

/**
 * The created Settings instance will be wrapped in a Proxy
 * instance to make usage simpler.
 *
 * @summary Create a new Setting instance.
 * @param {string} filepath - Where to read/write files from/to.
 * @param {string} releaseName - name of the linked release
 * @returns {Proxy} - Proxified release settings object.
 */
exports.get = function (filepath, releaseName) {
  const settings = new Settings(filepath, releaseName, this.modules)
  return proxy(settings, '_settings')
}

/**
 * The generated proxy will return the default if value is undefined.
 *
 * @summary Proxify setting entries
 * @param {Object} settingData - key-value map
 * @returns {Object} Proxified version of the setting
 * @private
 */
function createSettingEntry(settingData) {
  return new Proxy(settingData, {
    get: function (setting, name) {
      if (name !== 'value') {
        return setting[name]
      }

      if (setting.value === undefined) {
        return setting.default
      } else {
        return setting.value
      }
    },
  })
}

/**
 * @summary Game settings information.
 * @param {string} filepath - Where to read/write files from/to.
 * @param {string} releaseName - name of the linked release
 * @param {Object} [modules] - Injected modules to use.
 *
 * @public
 * @constructor
 */
const Settings = function (filepath, releaseName, modules = exports.modules) {
  Object.defineProperty(this, 'modules', {
    value: modules,
    enumerable: false,
  })
  const {
    fs,
  } = this.modules

  fs.accessSync(filepath)
  this.releaseName = releaseName
  this._filepath = path.join(filepath, SETTINGS_FILE_NAME)
  this._oldSettings = {}

  this.readFromFile()
}

util.inherits(Settings, EventEmitter)

/**
 * @summary Update settings values and emit if some values have changed
 * @returns {undefined} void
 * @private
 */
Settings.prototype.emitIfModified = function () {
  const settings = this.get()
  if (!deepEqual(this._oldSettings, settings)) {
    this._oldSettings = settings
    this.emit('update', this)
  }
}

/**
 * Note that old values will remain for setting keys Note
 * specified in the object passed as a parameter, e.g.
 *
 *   ```javascript
 *   settings.set({})
 *   ```
 *
 * Changes no settings.
 *
 * @summary Set settings using an object.
 * @param {Object} newSettings - key-value map of settings to alter.
 * @returns {undefined} void
 */
Settings.prototype.set = function (newSettings) {
  const settings = this._settings

  const currentSettingsKeys = Object.keys(settings)
  const newSettingsKeys = Object.keys(newSettings)

  newSettingsKeys.filter(function (settingName) {
    if (!currentSettingsKeys.includes(settingName)) {
      throw new Error(`Invalid setting entry: ${settingName}`)
    }

    return true
  }).forEach(function (settingName) {
    settings[settingName].value = newSettings[settingName]
  })

  this.emitIfModified()
  this.saveToFile()
}

/**
 * This can be useful when wanting to access the settings values themselves
 * instead of all the additional information normally stored for each settings.
 *
 * @summary Get a key-value map of each settings.
 * @returns {Object} settings - key-value map of settings name and their values.
 */
Settings.prototype.get = function () {
  const settings = {}
  Object.keys(this._settings).forEach((settingName) => {
    settings[settingName] = this._settings[settingName].value
  })

  return settings
}

/**
 * Retrieves full settings configuration
 *
 * @summary Get a key-configuration map of each settings.
 * @returns {Object} settings - key-configuration map of settings name and their configuration.
 */
Settings.prototype.getConfiguration = function () {
  return this._settings
}

/**
 * This should receive the `Configuration.settings` portion of
 * a Configuration object as a first parameter.
 *
 * @summary Update available settings according to configuration.
 * @param {Configuration} configuration - Settings portion of a given configuration object.
 * @returns {undefined} void
 */
Settings.prototype.updateAvailableSettings = function (configuration) {
  const settings = this._settings
  const configurationNames = configuration.map(function (config) {
    return config.name
  })

  // Clean up setting options that should no longer be available
  Object.keys(settings).forEach(function (settingName) {
    if (!configurationNames.includes(settingName) && !COMMON_SETTINGS[settingName]) {
      delete settings[settingName]
    }
  })

  // Set default values and update display information
  configuration.forEach(function (newSetting, i) {
    const settingName = newSetting.name
    const currentSetting = settings[settingName]

    if (currentSetting) {
      Object.assign(currentSetting, newSetting)
    } else {
      settings[settingName] = createSettingEntry(newSetting)
      settings[settingName].order = i
    }
  })

  Object.keys(COMMON_SETTINGS).forEach((settingName) => {
    // only the main release have the displayAllReleases setting
    if (!settings[settingName] && (settingName !== KEYS.DISPLAY_ALL_RELEASES || this.releaseName === 'main')) {
      settings[settingName] = createSettingEntry(COMMON_SETTINGS[settingName])
    }
  })

  // Save result to file
  this.emitIfModified()
  this.saveToFile()
}

/**
 * @summary Save the content in memory to file.
 * @returns {undefined} void
 */
Settings.prototype.saveToFile = function () {
  const {
    fs,
  } = this.modules

  fs.writeFileSync(this._filepath, JSON.stringify(this._settings))
}

/**
 * @summary Read from file.
 * @returns {undefined} void
 */
Settings.prototype.readFromFile = function () {
  const {
    fs,
  } = this.modules

  this._settings = {}

  try {
    const data = fs.readFileSync(this._filepath)
    const settings = JSON.parse(data)

    Object.keys(settings).forEach((settingName) => {
      this._settings[settingName] = createSettingEntry(settings[settingName])
    })

    this.emitIfModified()
  } catch (error) {
    logger.warn('Failed to read settings file:', error.message)
  }
}
