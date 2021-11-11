/**
 * Access static build configuration information.
 *
 * This module is simply a wrapper around `buildconfig.json`, which
 * hold the static build configuration data. Data may include:
 *
 *   - Build date, time
 *   - Build server and build user
 *   - Commit revision number (extracted from git)
 *   - Cytrus repository to connect to
 *   - External services connection information
 *
 * You will need to make sure to set the `NODE_ENV`
 * environment variable whenever making build. If not set,
 * we will use 'development' by default.
 *
 * @module zaap/buildConfig
 */
const logger = require('./logger')
const inject = require('instill')
const proxy = require('munchausen')
const ipcMain = require('electron').ipcMain
const remoteCommunication = require('./remoteCommunication')

module.exports = exports = proxy(exports, '_data')

/* istanbul ignore next */
inject(exports, {
  getApp: function () {
    return require('./app')
  },
  require,
  env: function () {
    return process.env.NODE_ENV || 'develop'
  },
}, null, function onWith(instance) {
  return proxy(instance, '_data')
})

/**
 * @private
 */
exports._data = {}

/**
 * Expose buildConfig defaults.
 * @type {Object}
 */
exports.defaults = {
  name: 'zaap',
  productName: 'Astrub Launcher',
}

/**
 * This module will attempt to load the `buildconfig.json`
 * file that should normally be at the top-level of the application's
 * folder (./app). However, if the file is not present (like during development),
 * it will attempt to find the buildconfig present in the `./build/configs` folder
 * of the project's directory (using the NODE_ENV environment variable - example: NODE_ENV=hello ->
 * ./build/configs/hello.json). If none are found, an error will be logged and the
 * application will exit.
 *
 * @summary Load the buildConfig.
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    env,
    require,
    getApp,
  } = this.modules

  const app = getApp()

  let buildConfig
  let isBuild = false

  try {
    buildConfig = require('../buildconfig.json')
    isBuild = true
  } catch (error) {
    try {
      buildConfig = require(`../../build/configs/${env()}.json`)
      logger.warn('buildconfig.json not found, loading configuration directly from the project\'s directory')
    } catch (ignoredError) {
      logger.error('Could not find build configuration anywhere!')
      logger.error('Failed to load build configuration!', error)
      return app.exit(1)
    }

    try {
      buildConfig = Object.assign(buildConfig, require(`../../build/configs/local.json`))
    } catch (ignoredError) {
      logger.warn('build/configs/local.json not found or could not be loaded')
    }
  }

  // Data for the environment
  this._data = Object.assign(this.defaults, buildConfig)

  // Allow to override environment in dev (no build) to debug other environments
  if (!isBuild) {
    this._data.environment = env()
  }

  // Is this a build or are we in development mode
  this._data.isBuild = isBuild

  // Ignore TLS fails in local
  /* istanbul ignore next */
  if (buildConfig.allowInsecureHttps) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  ipcMain.on(
    remoteCommunication.CHANNELS.BUILD_CONFIG_GET,
    (event) => {
      event.returnValue = this._data
    }
  )
}
