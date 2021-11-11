const path = require('path')
const inject = require('instill')
const app = require('../../app')

inject(exports, {
  getReleaseModule() {
    return require('../../games/release')
  },
  logger: require('../../logger'),
  fs: require('fs'),
})

/**
 * @property Configuration file developers can create to register their in-development games
 */
exports.CONFIG_FILE = path.join(app.getPath('home'), 'zaap-development.json')

/**
 * @property List of known development releases
 */
exports.releases = []

/**
 * @property Internal watcher process
 */
exports.watcher = null

/**
 * @summary Check if the development mode is watching the development file
 * @returns {boolean} True if watching
 */
exports.isWatching = function () {
  return !!this.watcher
}

/**
 * @summary Watch this user's devel. file for this service instance
 * @param {service} service Service module instance
 * @returns {undefined} void
 */
exports.watch = function (service) {
  if (this.isWatching()) {
    throw new Error('Another service instance is already watching the development file!')
  }

  const {
    fs,
  } = this.modules

  const {
    CONFIG_FILE,
  } = this

  // Initial sync
  this.syncReleasesFromFile(service)

  this.watcher = fs.watchFile(CONFIG_FILE, (stats) => {
    this.removeAllGames(service)

    if (stats.dev === 0) {
      return
    }

    this.syncReleasesFromFile(service)
  })
}

/**
 * @summary Stop watching the development file
 * @returns {undefined} void
 */
exports.unwatch = function () {
  if (this.isWatching()) {
    this.watcher.stop()
  }
}

/**
 * @summary Read the development file's content
 * @param {Function} callback callback function receiving the file's data
 * @returns {undefined} void
 */
exports.readDevelopmentFile = function (callback) {
  const {
    fs,
  } = this.modules

  const {
    CONFIG_FILE,
  } = this

  fs.readFile(CONFIG_FILE, callback)
}

/**
 * @summary Parse the dev releases in the dev file, and register them internally
 * @param {service} service Service module instance
 * @param {Function} callback callback function receiving the file's data
 * @returns {undefined} void
 */
exports.syncReleasesFromFile = function (service) {
  const {
    logger,
  } = this.modules

  logger.debug('service:development: syncing services from ' + this.CONFIG_FILE)

  this.readDevelopmentFile((error, data) => {
    if (error) {
      if (!error.message.includes('ENOENT')) {
        logger.error('service:development: failed to read development file', error)
      }

      return
    }

    let list
    try {
      list = JSON.parse(data)
    } catch (error) {
      return logger.error('service:development: failed to sync games from local development file', error)
    }

    list.forEach((data) => {
      this.addRelease(service, data, function (error) {
        if (error) {
          logger.error('service:development: failed to register game or create a credential file', error)
        }
      })
    })
  })
}

/**
 * @summary Internally register a dev release.
 * @param {service} service Service module instance
 * @param {Object} releaseInfo release information specified in the file
 * @param {Function} callback callback function returning an error if one occurs
 * @returns {undefined} void
 */
exports.addRelease = function (service, releaseInfo, callback) {
  const {
    logger,
    getReleaseModule,
  } = this.modules

  const rel = getReleaseModule().get(
    releaseInfo.gameUid,
    releaseInfo.gameId,
    releaseInfo.gameOrder,
    releaseInfo.gameName,
    releaseInfo.name,
    null,
    app.getPath('temp'))
  rel.location = releaseInfo.location
  rel.setup()

  const info = service.createEnvironmentForRelease(rel)

  logger.debug('Registering development release', {
    releaseInfo,
    info,
  })

  this.releases.push({
    release: rel,
    info,
  })

  this.writeReleaseCredentialsFile(releaseInfo.location, {
    port: info.env.ZAAP_PORT,
    name: info.env.ZAAP_GAME,
    release: info.env.ZAAP_RELEASE,
    instanceId: info.env.ZAAP_INSTANCE_ID,
    hash: info.env.ZAAP_HASH,
  }, callback)
}

/**
 * @summary Write a credential file for the dev release to use at runtime
 * @param {string} filepath location where the dev release folder may be found
 * @param {Object} content file content
 * @param {Function} callback callback function returning an error if one occurs
 * @returns {undefined} void
 */
exports.writeReleaseCredentialsFile = function (filepath, content, callback) {
  const {
    fs,
  } = this.modules

  const credentialsFilepath = path.join(filepath, 'credentials.json')
  fs.writeFile(credentialsFilepath, JSON.stringify(content), callback)
}

/**
 * @summary Remove all known game instances
 * @param {service} service Service module instance
 * @returns {undefined} void
 */
exports.removeAllGames = function (service) {
  const {
    logger,
  } = this.modules

  logger.debug('service:development: unregistering all development releases')

  this.releases.forEach(function ({ release, info }) {
    service.invalidateCredentials(release, info.id)
  })

  this.releases = []
}
