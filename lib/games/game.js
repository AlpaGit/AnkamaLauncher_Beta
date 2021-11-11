/**
 * The Game module is used to create Game instances which are used
 * to keep track of and manage each game's release information and
 * versions.
 *
 * Game instances are NOT in charge of running the actual games; this,
 * instead, is a responsibility of the releases that the game object holds
 * references to.
 *
 * @summary Game manager.
 * @module zaap/games/game
 */
const path = require('path')
const inject = require('instill')
const util = require('util')
const EventEmitter = require('events')
const helpers = require('./helpers')

/* istanbul ignore next */
inject(exports, {
  fs: require('fs-extra'),
  release: require('./release'),
  logger: require('../logger'),
  remoteCommunication: require('../remoteCommunication'),
})

/**
 * @summary Create a new Game instance
 * @param {Repository} repository - Repository to run update and repairs against.
 * @param {String} uid - The uid of this game in the remote repository
 * @param {Number} id - The id of this game in the remote repository
 * @param {Number} order - The order of this game in the remote repository
 * @param {String} name - The name of this game in the remote repository
 * @param {string} filepath - Where to read/write release data from/to.
 * @returns {Game} - Game object
 */
exports.get = function (repository, uid, id, order, name, filepath) {
  return new Game(repository, uid, id, order, name, filepath, this.modules)
}

/**
 * @summary Game object.
 * @param {Repository} repository - Repository to run update and repairs against.
 * @param {String} uid - The uid of this game in the remote repository
 * @param {Number} id - The id of this game in the remote repository
 * @param {Number} order - The order of this game in the remote repository
 * @param {String} name - The name of this game in the remote repository
 * @param {string} filepath - Where to read/write release data from/to.
 * @param {Object} [modules] - Injected modules to use.
 *
 * @public
 * @constructor
 */
const Game = function (repository, uid, id, order, name, filepath, modules = exports.modules) {
  Object.defineProperty(this, 'modules', {
    value: modules,
    enumerable: false,
  })

  const {
    fs,
  } = this.modules

  fs.accessSync(filepath)

  this.uid = uid
  this.id = id
  this.order = order
  this.name = name
  this.filepath = filepath
  Object.defineProperty(this, 'repository', {
    value: repository,
    enumerable: false,
  })

  this.releases = {}

  this.releaseUpdateCallback = this.onReleaseUpdateEventHandler.bind(this)
}

util.inherits(Game, EventEmitter)

/**
 * Clear the data and the listeners.
 * Must be called when the game is no longer used.
 *
 * @summary Destroy the game.
 * @return {undefined} void
 */
Game.prototype.destroy = function () {
  Object.keys(this.releases).forEach((key) => {
    this.releases[key].destroy()
  })
  this.releases = {}
}

/**
 * This method receives a pre-parsed list of information and release
 * versions from the registry, creates instances which needs to be created,
 * update existing ones, and either delete or mark as deleted releases that
 * are no longer available.
 *
 * @summary Update the list of managed releases.
 * @param {Number} gameId - Game ID
 * @param {Number} gameOrder - Game order index
 * @param {String} gameName - Game name to display
 * @param {Object} data - Filtered data from the remote repository
 * @param {Object} data.information - key-value mapping of release names and the information timestamp.
 * @param {Object} data.releases - key-value mapping of release names and their current version.
 * @param {Function} callback - callback function.
 * @returns {undefined} void
 */
Game.prototype.update = function (
  gameId,
  gameOrder,
  gameName,
  { // data
    information,
    releases,
  },
  callback
) {
  const removedReleases = Object.keys(this.releases)
  const runner = helpers.createAsyncRunner(() => {
    this.updateReleasesOrder()
    callback()
  })

  /**
   * @callback Game~update
   * @param {Error|null} error - Error object (or null if no error)
   */
  // Add and update releases
  Object.keys(releases).forEach((releaseName) => {
    const releaseVersion = releases[releaseName]
    const informationVersion = information[releaseName]

    if (!this.isReleaseExist(releaseName)) {
      this.createRelease(releaseName)
    } else {
      const index = removedReleases.indexOf(releaseName)
      removedReleases.splice(index, 1)
    }

    runner.run(() => this.updateRelease(
      releaseName,
      releaseVersion,
      informationVersion,
      gameId,
      gameOrder,
      gameName,
      runner.checkIfDone
    ))
  })

  // Remove or mark as unavailable the remainder
  removedReleases.forEach(this.markReleaseAsRemoved.bind(this))
  runner.checkIfDone()
}

/**
 * @summary Update the release order. The order of the main release will always be set to 0.
 * @returns {undefined} void
 */
Game.prototype.updateReleasesOrder = function () {
  const releaseNames = Object.keys(this.releases).sort((releaseName1, releaseName2) => {
    const releaseName1Order = releaseName1 === 'main' ? -1 : releaseName1.charCodeAt(0)
    const releaseName2Order = releaseName2 === 'main' ? -1 : releaseName2.charCodeAt(0)
    return releaseName1Order - releaseName2Order
  })

  releaseNames.forEach((releaseName, order) => {
    this.releases[releaseName].order = order
  })
}

/**
 * @summary Check if a release exist for this game.
 * @param {String} releaseName - The name of the release.
 * @returns {boolean} True if the release exists.
 */
Game.prototype.isReleaseExist = function (releaseName) {
  return !!this.releases[releaseName]
}

/**
 * Throws if the release does not exist for this game.
 *
 * @summary Get the release instance.
 * @param {String} releaseName - The name of the release.
 * @returns {Release} The release object.
 */
Game.prototype.getRelease = function (releaseName) {
  const rel = this.releases[releaseName]

  if (!rel) {
    throw new Error(`Release not found: ${releaseName}`)
  }

  return rel
}

/**
 * @summary Create an empty release.
 * @param {String} releaseName - The name of the release.
 * @returns {undefined} void
 */
Game.prototype.createRelease = function (releaseName) {
  const {
    release,
    fs,
  } = this.modules

  const releaseFilepath = path.join(this.filepath, releaseName)
  fs.mkdirpSync(releaseFilepath)

  // Create the release
  const releaseInstance = release.get(
    this.uid,
    this.id,
    this.order,
    this.name,
    releaseName,
    this.repository,
    releaseFilepath
  )
  releaseInstance.setup()

  this.releases[releaseName] = releaseInstance
  releaseInstance.on('update', this.releaseUpdateCallback)
}

/**
 * @summary Callback called when the a release has been updated
 * @returns {undefined} void
 */
Game.prototype.onReleaseUpdateEventHandler = function () {
  const {
    remoteCommunication,
  } = this.modules

  remoteCommunication.send(remoteCommunication.CHANNELS.GAME_UPDATED, this.expose())
}

/**
 * This will trigger a synchronisation of the information files if necessary.
 *
 * @summary Update the release's version and information
 * @param {String} releaseName - The name of the release.
 * @param {String} repositoryVersion - The version of the release in the repository.
 * @param {String} informationVersion - The version timestamp for the presentation information.
 * @param {Number} gameId - Game ID
 * @param {Number} gameOrder - Game order index
 * @param {String} gameName - Game name to display
 * @param {Game~updateReleaseCallback} callback - Callback function.
 * @returns {undefined} void
 */
Game.prototype.updateRelease = function (
  releaseName,
  repositoryVersion,
  informationVersion,
  gameId,
  gameOrder,
  gameName,
  callback
) {
  const rel = this.getRelease(releaseName)
  rel.setRepositoryVersion(repositoryVersion)
  rel.updateGameData(gameId, gameOrder, gameName)

  // don't emit an update event as the information is not available
  rel.saveToDisk(false)

  /**
   * @callback Game~updateReleaseCallback
   * @param {Error|null} error - Error object
   */
  if (informationVersion && rel.information.version !== informationVersion) {
    this.updateReleaseInformation(releaseName, informationVersion, callback)
  } else {
    rel.information.setAssetsLoaded()
    callback()
  }
}

/**
 * This manages the synchronisation of the release information files.
 *
 * @summary Update the release information.
 * @param {String} releaseName - The name of the release.
 * @param {String} informationVersion - The version timestamp for the presentation information.
 * @param {Game~updateReleaseCallback} callback - Callback function.
 * @returns {undefined} void
 */
Game.prototype.updateReleaseInformation = function (releaseName, informationVersion, callback) {
  const {
    logger,
  } = this.modules

  const rel = this.getRelease(releaseName)
  this.repository.getInformation(this.uid, informationVersion)
    .then(stream => rel.information.updateFromRepositoryStream(informationVersion, stream, callback))
    .catch((error) => {
      /* istanbul ignore next */
      logger.warn('game: cannot update release information', error)
    })
}

/**
 * @summary Mark all releases as removed.
 * @returns {undefined} void
 */
Game.prototype.markAllReleasesAsRemoved = function () {
  Object.keys(this.releases).forEach(this.markReleaseAsRemoved.bind(this))
}

/**
 * Game releases that are currently installed will NOT be removed until they are
 * uninstalled.
 *
 * @summary Removes or mark a release as no longer available in the repository.
 * @param {String} releaseName - The name of the release.
 * @returns {undefined} void
 */
Game.prototype.markReleaseAsRemoved = function (releaseName) {
  const rel = this.getRelease(releaseName)
  rel.repositoryVersion = false

  // Installed releases will not be removed - they
  // should instead be removed upon uninstall
  if (rel.isInstalled()) {
    rel.saveToDisk()
  } else {
    this.removeRelease(releaseName)
  }
}

/**
 * @summary Remove entirely the release and delete its local folder.
 * @param {String} releaseName - The name of the release.
 * @returns {undefined} void
 */
Game.prototype.removeRelease = function (releaseName) {
  const {
    logger,
    fs,
  } = this.modules

  const rel = this.releases[releaseName]
  rel.removeListener('update', this.releaseUpdateCallback)
  delete this.releases[releaseName]

  /* istanbul ignore next */
  if (rel.filepath) {
    try {
      fs.removeSync(rel.filepath)
    } catch (error) {
      logger.warn(`Failed to delete ${rel.filepath} from disk:`, error)
    }
  }
}

/**
 * @summary Create a light object that can be used by the renderer process.
 * @returns {Object} The light object
 */
Game.prototype.expose = function () {
  const lightObject = {
    uid: this.uid,
    id: this.id,
    order: this.order,
    name: this.name,
  }

  const releases = {}
  Object.keys(this.releases).forEach((releaseName) => {
    const release = this.releases[releaseName]
    releases[releaseName] = release.expose()
  })
  lightObject.releases = releases

  return lightObject
}
