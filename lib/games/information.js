/**
 * The information module is the module responsible for keeping
 * the presentation information used by Zaap's frontend available
 * and up-to-date.
 *
 * @summary Game release information.
 * @module zaap/games/information
 */
const path = require('path')
const inject = require('instill')
const util = require('util')
const EventEmitter = require('events')

/* istanbul ignore next */
inject(exports, {
  packageInfo: require('../../package.json'),
  logger: require('../logger'),
  getTar: () => require('tar-fs'),
  fs: require('fs-extra'),
})

const SCHEMA_VERSION_KEY = '_schemaVersion'
const INFORMATION_FILE_NAME = 'information.json'
const DATA_DIR = 'data'

/**
 * The created Information instance will be wrapped in a Proxy
 * instance to make usage simpler.
 *
 * @summary Create a new Information instance.
 * @param {string} filepath - Where to read/write files from/to.
 * @returns {Proxy} - Proxied release information object.
 */
exports.get = function (filepath) {
  const information = new this.Information(filepath, this.modules)
  return new Proxy(information, {
    getOwnPropertyDescriptor: function (target, prop) {
      return {
        configurable: true,
        enumerable: prop !== 'modules',
        value: this.get(target, prop),
      }
    },
    ownKeys: function (target) {
      const keys = Object.keys(target._information)
      keys.push('version')
      keys.push('url')

      return keys
    },
    get: function (target, name) {
      const informationData = target._information

      if (target[name] !== undefined) {
        return target[name]
      } else if (informationData[name] !== undefined) {
        return informationData[name]
      } else {
        return undefined
      }
    },
    set: function (target, name, val) {
      const informationData = target._information
      const mutables = [
        '_information',
        'version',
        'url',
        '_events',
        '_eventsCount',
        'assetsLoaded',
      ]

      if (informationData[name] || !mutables.includes(name)) {
        throw new Error(`Cannot set values on an information object instance (key: ${name})`)
      } else {
        target[name] = val
        return true
      }
    },
  })
}

/**
 * @summary Game release information.
 * @param {string} filepath - Where to read/write files from/to.
 * @param {Object} [modules] - Injected modules to use.
 *
 * @public
 * @constructor
 */
const Information = function (filepath, modules = exports.modules) {
  this.modules = modules
  const {
    fs,
  } = this.modules

  fs.accessSync(filepath)

  this.assetsLoaded = false
  this.filepath = path.resolve(filepath)
  this.dataDirPath = path.join(this.filepath, DATA_DIR)
  this.url = `file://${this.dataDirPath.replace(/\\/g, '/')}`

  fs.mkdirpSync(this.dataDirPath)
  this.readFromFiles()
}

exports.Information = Information

util.inherits(Information, EventEmitter)

/**
 * @summary Get the absolute file path for a given file.
 * @param {String} relativePath - The path relative to the information filepath.
 * @returns {String} String Absolute path to a file.
 */
Information.prototype.getPathFor = function (relativePath) {
  return path.join(this.filepath, relativePath)
}

/**
 * @summary Update the assetsLoaded state.
 * @returns {undefined} void
 */
Information.prototype.setAssetsLoaded = function () {
  this.assetsLoaded = true
}

/**
 * @summary Download and extract to disk an information tar file from a Cytrus repository.
 * @param {String} version - The version to update the local files to.
 * @param {stream.ReadableStream} stream - Readable stream. Must point to TAR formatted data.
 * @param {Information~updateFromRepositoryStreamCallback} callback - callback function.
 * @returns {undefined} void
 */
Information.prototype.updateFromRepositoryStream = function (version, stream, callback) {
  const {
    getTar,
    logger,
  } = this.modules

  let filesToKeep = []

  const tarStream = getTar().extract(this.dataDirPath, {
    ignore(filePath) {
      filesToKeep.push(filePath)
      return false
    },
  })
  stream.pipe(tarStream)
  /* istanbul ignore next */
  stream.on('error', (error) => {
    logger.error('updateFromRepositoryStream', error)
    callback(error)
  })
  tarStream.on('finish', () => {
    this.cleanDataDir(this.dataDirPath, filesToKeep)
    this.updateVersion(version)
    this.readFromFiles()

    // update status and emit event
    this.setAssetsLoaded()

    /**
     * @callback Information~updateFromRepositoryStreamCallback
     * @param {Error|null} error - Error object (or null if no errors)
     */
    callback()
  })
}

/**
 * @summary Update the version timestamp.
 * @param {String} version - The version to update to.
 * @returns {undefined} void
 */
Information.prototype.updateVersion = function (version) {
  const {
    fs,
  } = this.modules

  const filepath = this.getPathFor(INFORMATION_FILE_NAME)
  this.version = version
  fs.writeFileSync(filepath, JSON.stringify({
    [SCHEMA_VERSION_KEY]: 1,
    version,
  }))
}

/**
 * @summary Load information data from file.
 * @returns {undefined} void
 */
Information.prototype.readFromFiles = function () {
  this.version = this.getVersionFromFile()
  this._information = this.getLocalesFromFiles()
  this._information.default = this.getDefaultFromFile()
}

/**
 * @summary Load data from a file in the filepath.
 * @param {String} description - Used for debugging if an error occurs.
 * @param {String} relativePath - File path to load.
 * @returns {Object} File data.
 * @private
 */
Information.prototype.getDataFromFile = function (description, relativePath) {
  const {
    fs,
    logger,
  } = this.modules

  const gameFile = this.getPathFor(relativePath)

  try {
    const fileContent = fs.readFileSync(gameFile)
    return JSON.parse(fileContent)
  } catch (error) {
    logger.debug(`Failed to load ${description} (${gameFile}):`, error.message)
  }

  return {}
}

/**
 * @summary Load data from a file in the data directory.
 * @param {String} description - Used for debugging if an error occurs.
 * @param {String} relativePath - File path to load.
 * @returns {Object} File data.
 * @private
 */
Information.prototype.getDataFromDataFile = function (description, relativePath) {
  return this.getDataFromFile(description, path.join(DATA_DIR, relativePath))
}

/**
 * @summary Get the version timestamp for the current information data.
 * @returns {String} Version read from file, or an empty string if not set.
 */
Information.prototype.getVersionFromFile = function () {
  let data = this.getDataFromFile('information data', INFORMATION_FILE_NAME)

  if (!data.version) {
    return ''
  }

  return data.version
}

/**
 * @summary List supported locale files.
 * @returns {String[]} Array of locally path to each supported locale.
 * @private
 */
Information.prototype.listLocaleFiles = function () {
  const {
    packageInfo,
  } = this.modules

  let locales = []

  packageInfo.supportedLanguages.forEach((supportedLanguage) => {
    locales.push(`${supportedLanguage}.json`)
  })

  return locales
}

/**
 * @summary Load default values from release.json
 * @returns {Buffer} File data.
 * @private
 */
Information.prototype.getDefaultFromFile = function () {
  const {
    packageInfo,
  } = this.modules

  const defaultLocalePath = path.join('locales', `${packageInfo.defaultLanguage}.json`)
  const releaseDefault = this.getDataFromDataFile('game file', 'release.json')
  const localeDefault = this.getDataFromDataFile('default locale file', defaultLocalePath)

  return Object.assign({}, releaseDefault, localeDefault)
}

/**
 * Locale data proxies to default data if an attribute is not present.
 *
 * @summary Load data from a locale file.
 * @param {String} locale - Locale to load.
 * @returns {Proxy} Proxy instance.
 * @private
 */
Information.prototype.getLocaleFromFile = function (locale) {
  const localeFile = path.join('locales', locale)
  const localeData = this.getDataFromDataFile(`locale file ${locale}`, localeFile)

  return new Proxy(localeData, {
    getOwnPropertyDescriptor(target, prop) {
      return {
        configurable: true,
        enumerable: true,
        value: this.get(target, prop),
      }
    },
    ownKeys: (target) => {
      const keys = Object.keys(target)
      const defaultKeys = Object.keys(this._information.default)
      defaultKeys.forEach(function (key) {
        if (!keys.includes(key)) {
          keys.push(key)
        }
      })

      return keys
    },
    get: (target, name) => {
      const defaultInformation = this._information.default

      if (target.hasOwnProperty(name)) {
        return target[name]
      } else if (defaultInformation && defaultInformation.hasOwnProperty(name)) {
        return defaultInformation[name]
      } else {
        return undefined
      }
    },
  })
}

/**
 * @summary Load all locale files.
 * @returns {Object} Locales data.
 * @private
 */
Information.prototype.getLocalesFromFiles = function () {
  const locales = this.listLocaleFiles()
  const localesData = {}

  locales.forEach((locale) => {
    const language = locale.substring(0, locale.length - 5)
    localesData[language] = this.getLocaleFromFile(locale)
  })

  return localesData
}

/**
 * @summary Clean data directory by keeping only newly extracted files.
 * @param {String} dirPath - Directory path to clean
 * @param {String[]} filesToKeep - List of file paths to keep (all files not in that list will be deleted)
 * @returns {undefined} void
 * @private
 */
Information.prototype.cleanDataDir = function (dirPath, filesToKeep) {
  const {
    fs,
  } = this.modules

  const dirContent = fs.readdirSync(dirPath)

  dirContent.forEach((file) => {
    const filePath = path.join(dirPath, file)
    if (!filesToKeep.includes(filePath)) {
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) {
        this.cleanDataDir(filePath, filesToKeep)
      } else {
        fs.unlinkSync(filePath)
      }
    }
  })

  // Remove if folder is empty
  if (dirContent.length === 0) {
    fs.rmdirSync(dirPath)
  }
}
