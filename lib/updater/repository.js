/**
 * The repository module is in charge of
 * downloading files from a remote repository,
 * poll said repository for changes and emit events
 * whenever updates are available.
 *
 * See the [updater tutorial](tutorial-Updater%20System.html) for more details.
 *
 * @module zaap/updater/repository
 */
const url = require('url')
const util = require('util')
const logger = require('../logger')
const inject = require('instill')
const promiseRetry = require('promise-retry')
const { promisify } = require('es6-promisify')
const deepEqual = require('deep-equal')
const { objectKeysToLowerCase } = require('../strings')

exports.CYTRUS_VERSION = 5

/* istanbul ignore next */
inject(exports, {
  fs: require('fs'),
  dns: require('dns'),
  electronFetch: require('electron-fetch'),
  settings: require('../settings'),
  buildConfig: require('../buildConfig'),
  fetch: require('../fetch'),
  timeOutMaxRetries: 2,
  timeOutMinInterval: 1000,
  timeOutMaxInterval: 2000,
})

const MIN_TTL = 30 // We do not want to get a TTL under 30 seconds

/**
 * Create a new Repository instance.
 *
 * @param {string} server - The server you wish to use (example: 'http://cytrus.ankama.lan').
 * @param {number} [pollingTime] - Poll the repository for changes every n milliseconds.
 * @returns {Repository} The given repository
 */
exports.get = function (server, pollingTime = 60 * 1000) {
  return new Repository(server, pollingTime, this.modules)
}

/**
 * @summary Cytrus Repository
 *
 * @classdesc Repository is an object that will help you retrieve information
 * from a remote cytrus HTTP repository.
 *
 * @public
 * @constructor
 *
 * @param {string} server - The server you wish to use (example: 'http://cytrus.ankama.lan').
 * @param {number} [pollingTime] - Poll the repository for changes every n milliseconds.
 * @param {Object} [modules] - Injected modules to use.
 *
 * @fires Repository#updates - Whenever an update of any kind happens.
 * @fires Repository#updates:check-failed - An error occurred while polling for updates.
 */
const Repository = function (server, pollingTime = 60 * 1000, modules = exports.modules) {
  Object.defineProperty(this, 'modules', {
    value: modules,
    enumerable: false,
  })

  const {
    settings,
  } = this.modules

  if (!server) {
    throw new Error('You need to specify a server whenever instantiating a repository')
  }

  const info = url.parse(server)

  if (info.protocol !== 'http:' && info.protocol !== 'https:') {
    throw new Error('Protocol must be either http: or https:')
  }

  let {
    protocol,
    host,
    pathname
  } = info

  if (pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  let [hostname, port] = host.split(':')

  /* istanbul ignore next */
  if (!port) {
    port = protocol === 'https:' ? 443 : 80
  }

  this.server = `${protocol}//${host}${pathname}`
  this.cachedServers = [
    this.server,
  ]

  this.host = host

  this.infos = {
    protocol,
    host,
    hostname,
    port,
    pathname,
  }
  
  console.log("Cyrius Server: " + protocol + "//" + host + " & " + hostname + ":" + port + "/" + pathname);
  
  this.pollingTime = pollingTime
  this.watcher = null
  this.refreshCachedServersTimeout = null
  this.refreshCachedServers()

  settings.watch(settings.KEYS.PRE_RELEASE, this.checkForUpdates.bind(this))
}

util.inherits(Repository, require('events'))

/**
 * @summary Check for changes in the current game list
 *
 * @param {Object} currentList - The initial list against which to compare the remote file against.
 * @returns {undefined} void
 */
Repository.prototype.checkForUpdates = function (currentList) {
  this.getGamesList().then((newList) => {
    if (!newList || newList.version !== exports.CYTRUS_VERSION) {
      return
    }

    const hasChanges = !deepEqual(currentList, newList)
    if (hasChanges) {
      currentList = newList

      /**
       * @summary The latest game list.
       *
       * @event module:zaap/updater/repository~Repository#updates
       * @param {object} updateData - List of games for which we have an update.
       */
      this.emit('update', currentList)
    }
  }).catch((error) => {
    /**
     * @summary Tried to fetch update information, and an error has occured.
     *
     * @event module:zaap/updater/repository~Repository#updates:check-failed
     * @param {Error} error - Error object.
     */
    this.emit('updates:check-failed', error)
  })
}

/**
 * @summary Watch repository for changes using short-polling.
 * @param {Object} currentList - The initial list against which to compare the remote file against.
 * @returns {undefined} void
 */
Repository.prototype.watch = function (currentList) {
  this.refreshCachedServers()
    .then(() => {
      this.watcher = setInterval(() => this.checkForUpdates(currentList), this.pollingTime)
      // Check changes once at start
      this.checkForUpdates(currentList)
    })
}

/**
 * @summary Stop watching repository for changes.
 * @returns {undefined} void
 */
Repository.prototype.unwatch = function () {
  clearInterval(this.watcher)
  clearTimeout(this.refreshCachedServersTimeout)
}

/**
 * This simply wraps around the request NPM module. Just like the module, you can use
 * this method to:
 *
 *   1. Set a callback and get a response through it
 *   2. Create a stream
 *
 * Keep in mind that you will normally want to do one or the other, not both.
 *
 * @summary Make a request to the repository, and return a streamable request object.
 * @param {string} subPath - the relative path to the file you wish to download.
 * @returns {Promise<stream.Readable>} - Promise resolved with the HTTP file stream
 */
Repository.prototype.streamableRequest = function (subPath) {
  const {
    electronFetch,
    buildConfig,
    timeOutMaxRetries,
    timeOutMinInterval,
    timeOutMaxInterval,
  } = this.modules

  const fullPath = this.server + subPath

  logger.debug(`request: ${subPath}`, {
    repository: this.server,
  })

  const doElectronFetch = (retry, retriesCount) => {
    return electronFetch(fullPath, {
      timeout: 2000 * retriesCount,
      useElectronNet: !buildConfig.allowInsecureHttps,
    }).then((response) => {
      return response.body
    }).catch((err) => {
      if (err.type !== 'request-timeout') {
        logger.error('repository:', err)
        throw err
      }

      logger.info(`repository: network timeout at ${fullPath}`)
      if (retriesCount === timeOutMaxRetries + 1) {
        throw err
      } else {
        retry(err)
      }
    })
  }

  const options = {
    retries: timeOutMaxRetries,
    minTimeout: timeOutMinInterval,
    maxTimeout: timeOutMaxInterval,
  }

  return promiseRetry(doElectronFetch, options)
}

/**
 * This simply wraps around the request NPM module. Just like the module, you can use
 * this method to:
 *
 *   1. Set a callback and get a response through it
 *   2. Create a stream
 *
 * Keep in mind that you will normally want to do one or the other, not both.
 *
 * @summary Make a request to the repository
 * @param {string} subPath - the relative path to the file you wish to download.
 * @returns {Promise<Buffer>} - Promise resolved with the buffer
 */
Repository.prototype.request = function (subPath) {
  return new Promise((resolve, reject) => {
    this.streamableRequest(subPath)
      .then((stream) => {
        let ret = new Buffer(0)
        stream.on('data', (data) => {
          ret = Buffer.concat([ret, data])
        })
        stream.on('error', (error) => {
          reject(error)
        })
        stream.on('end', () => {
          resolve(ret)
        })
      })
      .catch(reject)
  })
}

/**
 * @summary Make a request to the repository, and return a promise.
 * @param {string} subPath - the relative path to the file you wish to download.
 * @returns {Promise} - Promise object of the file download.
 */
Repository.prototype.fetch = function (subPath) {
  logger.debug(`fetch request: ${subPath}`)
  return this.request(subPath)
}

/**
 * @summary Make a request to the repository, and return a JSON object.
 * @param {string} subPath - The relative path to the file you wish to download.
 * @returns {Promise} - Promise object of the file download.
 */
Repository.prototype.fetchJSON = function (subPath) {
  return this.fetch(subPath).then(function (res) {
    logger.debug(`fetchJson: Parsing data for ${subPath}`)
    return JSON.parse(res)
  })
}

/**
 * @summary Deep merge an object into another
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} - Merged target object
 */
function deepMerge(target, source) {
  Object.keys(source)
    .filter((key) => source[key] instanceof Object)
    .forEach((key) => Object.assign(source[key], deepMerge(target[key], source[key])))

  return Object.assign(target || {}, source)
}
exports.deepMerge = deepMerge

/**
 * @summary Retrieve the list of games currently available in this repository.
 * @returns {Promise} - Promise object representing the repository file.
 */
Repository.prototype.getGamesList = function () {
  const {
    settings,
  } = this.modules

  const {
    PRE_RELEASE,
  } = settings.KEYS

  return this.fetchJSON('/cytrus.json').then((gamesList) => {
    if (!gamesList.version || gamesList.version !== exports.CYTRUS_VERSION) {
      this.unwatch()
      logger.warn('repository: cytrus version not supported', gamesList.version, gamesList.Version)
      gamesList = objectKeysToLowerCase(gamesList)
    }

    if (!(settings.get(PRE_RELEASE) && gamesList.hasOwnProperty('preReleasedGames'))) {
      delete gamesList.preReleasedGames
      return gamesList
    }

    deepMerge(gamesList.games, gamesList.preReleasedGames)
    delete gamesList.preReleasedGames

    return gamesList
  })
}

/**
 * @summary Retrieve the list of files for a game at a given  version, for a given platform (darwin, windows, linux)
 * @param {string} gameUid - The uid of the game we wish to update.
 * @param {string} release - The release from which to update the game.
 * @param {string} platform - The platform (darwin, windows, linux) to update the game for.
 * @param {string} version - The version we wish to download.
 * @returns {Promise} - Promise object representing the release file.
 */
Repository.prototype.getRelease = function (gameUid, release, platform, version) {
  const file = ['', gameUid, 'releases', release, platform, version + '.json'].join('/')
  return this.fetchJSON(file)
}

/**
 * @summary Retrieve the list of fragment sizes for a game at a given version,
 * for a given platform (darwin, windows, linux)
 * @param {string} gameUid - The uid of the game we wish to update.
 * @param {string} release - The release from which to update the game.
 * @param {string} platform - The platform (darwin, windows, linux) to update the game for.
 * @param {string} version - The version we wish to download.
 * @returns {Promise} - Promise object representing the release file.
 */
Repository.prototype.getReleaseMeta = function (gameUid, release, platform, version) {
  const file = ['', gameUid, 'releases', release, platform, version + '.meta'].join('/')
  return this.fetchJSON(file)
}

/**
 * @summary Retrieve the configuration fragment for a game at a given  version, for a given platform
 * (darwin, windows, linux)
 * @param {string} gameUid - The uid of the game we wish to update.
 * @param {string} release - The release from which to update the game.
 * @param {string} platform - The platform (darwin, windows, linux) to update the game for.
 * @param {string} version - The version we wish to download.
 * @returns {Promise} - Promise object representing the release file.
 */
Repository.prototype.getReleaseConfig = function (gameUid, release, platform, version) {
  const file = ['', gameUid, 'releases', release, platform, version + '.config'].join('/')
  return this.fetchJSON(file)
}

/**
 * @summary Get a readable stream reader for a hash stored in the repository
 * @param {string} gameUid - The uid of the game for which we wish to get the hash.
 * @param {string} hash - The hash we want to download.
 * @returns {Promise<stream.Readable>} - Promise resolved with the stream object of the hash file we want to download.
 */
Repository.prototype.getHash = function (gameUid, hash) {
  const file = ['', gameUid, 'hashes', hash.substr(0, 2), hash].join('/')
  return this.streamableRequest(file)
}

/**
 * @summary Get a tarball containing display information.
 * @param {string} gameUid - The uid of the game for which we wish to get the information file.
 * @param {string} hash - The hash of the tar file we want to download.
 * @returns {Promise<stream.Readable>} - Promise resolved with the stream object of the hash file we want to download.
 */
Repository.prototype.getInformation = function (gameUid, hash) {
  return this.getHash(gameUid, hash)
}

/**
 * @summary Refresh cached servers at TTL interval
 * @returns {Promise} When the cached servers are refreshed
 */
Repository.prototype.refreshCachedServers = function () {
  const {
    dns,
  } = this.modules

  const {
    protocol,
    hostname,
    port,
    pathname,
  } = this.infos

  let minComputedTtl = MIN_TTL * 10 // We start the min computed TTL at 5 minutes, which is the max TTL

  return promisify(dns.resolve4)(hostname, { ttl: true })
    .then((addresses) => {
      this.cachedServers = addresses.map(({ address, ttl }) => {
        // Decrease the TTL at the minimum value
        if (ttl < minComputedTtl) {
          minComputedTtl = ttl
        }
        return `${protocol}//${address}:${port}${pathname}`
      })

      clearTimeout(this.refreshCachedServersTimeout)
      this.refreshCachedServersTimeout = setTimeout(
        this.refreshCachedServers.bind(this),
        Math.max(MIN_TTL, minComputedTtl) * 1000
      )
    })
    .catch((error) => {
      /* istanbul ignore next */
      logger.warn('No caching available, requests will hit DNS!', error)
    })
}
