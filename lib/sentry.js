/**
 * This module is responsible for capturing any fatal error and crashes,
 * and automatically sending them to Sentry so that we may investigate the issue.
 *
 * We also directly expose the Sentry client library we use (called raven)
 * so that we may use it to specifically report other non-uncaught errors
 * manually.
 *
 * The API for this module, except for the addition of the API
 * provided by instill (for injecting dependencies) and the `setup` function,
 * is the same as `raven` the sentry client used by this project.
 * Please refer to [raven's documentation](https://docs.sentry.io/clients/node/).
 *
 * @module zaap/sentry
 */
const inject = require('instill')
const proxy = require('munchausen')
const raven = require('raven')

module.exports = exports = proxy(exports, '_client')

/* istanbul ignore next */
inject(exports, {
  packageInfo: require('../package.json'),
  buildConfig: require('./buildConfig'),
  os: require('os'),
  settings: require('./settings'),
  logger: require('./logger'),
  device: require('./device'),
}, null, function onWith(instance) {
  return proxy(instance, '_client')
})

/**
 * @private
 */
exports._client = {}

/**
 * This will load data from the buildConfig and the application's
 * `package.json`, and inject it as context data to be used whenever
 * data is sent to sentry. Also, if a DSN is passed, global error handling
 * will be patched to that unhandled errors are sent directly to sentry.
 *
 * @summary Setup the sentry client.
 * @returns {Object} - Computed configuration.
 */
exports.setup = function () {
  const {
    device,
    packageInfo,
    buildConfig,
    os,
    settings,
    logger,
  } = this.modules

  // Extract sentry configuration from buildConfig
  const sentry = buildConfig.sentry || {}
  const dsn = sentry.dsn || false
  const config = sentry.config || {}

  // Make sure the tags attribute is an object
  config.tags = config.tags || {}

  // Add build metadata from buildConfig
  Object.assign(config.tags, buildConfig.build)


  // Make sure to specify the current release and environment
  config.release = packageInfo.version
  config.environment = buildConfig.environment

  // Get tons of client OS data
  config.tags.clientPlatform = os.platform()
  config.tags.clientPlatformVersion = os.release()
  config.tags.clientArch = os.arch()
  config.tags.clientTotalMem = os.totalmem()
  config.tags.clientCpuCores = os.cpus().length
  config.tags.clientCpuModel = os.cpus()[0].model.replace(/\s+/g, ' ')

  if (buildConfig.watermark) {
    config.tags.watermark = buildConfig.watermark
  }

  // Disable default logging
  raven.utils.disableConsoleAlerts()

  // Do some real-time data alteration, log the event id
  config.dataCallback = function (data) {
    logger.error('Sending error data to sentry, event id:', data.event_id)

    // We are not a server
    delete data.server_name

    data.tags.clientMemUsage = Math.round((os.totalmem() - os.freemem()) / os.totalmem() * 100) + '%'
    data.tags.clientFreeMem = os.freemem()
    data.user = {}

    // Add hostname and username for internal builds only
    /* istanbul ignore next */
    if (buildConfig.internal || config.tags.watermark) {
      data.user.hostname = os.hostname()
      data.user.username = os.userInfo().username
    }

    try {
      const userInfo = settings.get(settings.KEYS.USER_INFO)
      if (userInfo && userInfo.id && userInfo.nickname) {
        data.user.accountId = userInfo.id
        data.user.name = userInfo.nickname
      }

      data.user.fingerPrint = device.getUid()
    } catch (err) {
      logger.warn('sentry: Unable to add user infos into sentry data', err)
    }

    return data
  }

  // Create the client instance
  const client = new raven.Client(dsn, config)

  // Only launch Sentry if we are not in test/dev
  /* istanbul ignore next */
  if (buildConfig.isBuild && ['internal', 'production'].includes(buildConfig.environment)) {
    client.install()
  }

  if (config.tags.watermark) {
    client.captureMessage(`Watermarked session [${config.tags.watermark}]`, {level: 'info', tags: config.tags})
  }

  this._client = client

  return {
    dsn,
    config,
  }
}
