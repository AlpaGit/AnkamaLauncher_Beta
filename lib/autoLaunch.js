/**
 * The Auto-launch module is used to configure whether the application
 * should start upon the operating system's startup.
 *
 * @module zaap/autoLaunch
 */
const inject = require('instill')

inject(exports, {
  app: require('./app'),
  AutoLaunch: require('auto-launch'),
  buildConfig: require('./buildConfig'),
  logger: require('./logger'),
  settings: require('./settings'),
})

exports.autoLauncher = null

/**
 * Setting up the autoLauncher will not automatically
 * set up the autoLaunch on the host; instead, it simply sets
 * up the endpoints so that when settings change, autoLaunch will
 * be re-configured automatically.
 *
 * @summary Set up the autoLauncher
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    app,
    AutoLaunch,
    buildConfig,
    logger,
    settings,
  } = this.modules

  const appPath = process.platform === 'darwin'
    ? (app.getPath('exe').split('.app/Content')[0] + '.app')
    : app.getPath('exe')

  this.autoLauncher = new AutoLaunch({
    name: app.getName(),
    isHidden: true,
    // Little hack: https://github.com/Teamwork/node-auto-launch/issues/28#issuecomment-263542357
    path: appPath,
  })

  const set = (value) => {
    if (buildConfig.isBuild) {
      logger.info('autoLaunch: setting to ' + value)
      this.setEnabled(value)
        .catch((error) => {
          logger.error('autoLaunch: cannot setEnabled', error)
        })
    } else {
      logger.info('autoLaunch: setting ignored in development mode (received: ' + value + ')')
    }
  }

  set(settings.get(settings.KEYS.AUTO_LAUNCH))

  settings.watch(settings.KEYS.AUTO_LAUNCH, set)
}

/**
 * @summary Set whether Zaap should autoLaunch be turned on or off
 * @param {boolean} value - Set to true to turn on autoLaunch
 * @returns {Promise} Promise Object
 */
exports.setEnabled = function (value) {
  /* istanbul ignore next */
  if (!this.autoLauncher) {
    throw new Error('AutoLauncher was not created; make sure to run autoLaunch.setup first')
  }

  return this.autoLauncher.isEnabled()
    .then((isEnabled) => {
      if (value !== isEnabled) {
        if (value) {
          return this.autoLauncher.enable()
        } else {
          return this.autoLauncher.disable()
        }
      }
    })
}
