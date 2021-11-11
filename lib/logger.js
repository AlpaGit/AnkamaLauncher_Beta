/**
 * This module is essentially a wrapper around Winston.
 * By default, it will create a Winston logger with basic
 * functionalities.
 *
 * Different contexts will require the logger to have different behaviours.
 * For instance, while we will be logging pretty output in development,
 * we will want to sometimes generate json log output during testing, and
 * write to log files when live. All of these contexts are expected to be configured
 * at the point of entry of the applications. Examples are:
 *
 *   * ./index.js
 *   * ./app/index.js
 *
 * @module zaap/logger
 */
const Winston = require('winston')
const inject = require('instill')
const path = require('path')
const remoteCommunication = require('./remoteCommunication')

const app = require('electron').app

const eol = {
  win32: '\r\n',
  darwin: '\n',
  linux: '\n',
}

/* istanbul ignore next */
inject(exports, {
  ipcMain: require('electron').ipcMain,
  fs: require('fs-extra'),
  // We encapsulate in a function to avoid circular dependencies issues
  getBuildConfig: function () {
    return require('./buildConfig')
  },
  platform: process.platform,
  logger: new Winston.Logger({
    transports: [
      new Winston.transports.Console({
        level: 'debug',
        handleExceptions: false,
        timestamp: true,
        prettyPrint: true,
        json: false,
        colorize: false,
      }),
    ],
  }),
})

exports.logdir = null

/**
 * @summary Setup logger. Must be called after buildConfig setup.
 * @returns {undefined} void
 */
exports.setup = function () {
  let {
    ipcMain,
    getBuildConfig,
    fs,
    logger,
    platform,
  } = this.modules

  let filename = ''

  // Select the folder for the platform
  switch (platform) {
    case 'darwin':
      filename = path.join(app.getPath('home'), 'Library', 'Logs')
      break
    case 'win32':
      filename = path.join(app.getPath('home'), 'AppData', 'Roaming')
      break
    case 'linux':
      filename = path.join(app.getPath('home'), '.config')
      break
  }

  const buildConfig = getBuildConfig()
  filename = path.join(filename, 'Ankama', buildConfig.name, 'application.log')

  this.logdir = path.dirname(filename)
  fs.mkdirpSync(this.logdir)

  ipcMain.on(remoteCommunication.CHANNELS.LOGGER_GET_LOGS_PATH, (event) => {
    event.returnValue = this.logdir
  })

  logger.add(
    new Winston.transports.File({
      filename: filename,
      level: 'info',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 1,
      eol: eol[platform],
      tailable: true,
      handleExceptions: false,
      timestamp: true,
      prettyPrint: true,
      json: false,
      colorize: false,
    }),
    null,
    true)
}

/**
 * @summary Debug log.
 * @param {...*} args - Arguments. See Winston's documentation for more details.
 * @returns {undefined} void
 */
exports.debug = function (...args) {
  const logger = this.modules.logger
  logger.debug(...args)
}

/**
 * @summary Info log.
 * @param {...*} args - Arguments. See Winston's documentation for more details.
 * @returns {undefined} void
 */
exports.info = function (...args) {
  const logger = this.modules.logger
  logger.info(...args)
}

/**
 * @summary Warning log.
 * @param {...*} args - Arguments. See Winston's documentation for more details.
 * @returns {undefined} void
 */
exports.warn = function (...args) {
  const logger = this.modules.logger
  logger.warn(...args)
}

/**
 * @summary Error log.
 * @param {...*} args - Arguments. See Winston's documentation for more details.
 * @returns {undefined} void
 */
exports.error = function (...args) {
  const logger = this.modules.logger
  logger.error(...args)
}
