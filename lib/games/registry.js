/**
 * The Games Registry is in charge of synchronising the list of locally
 * known games with the list from the repository, both in memory and
 * to disk in files at different locations.
 *
 * @module zaap/games/registry
 */
const path = require('path')
const util = require('util')
const inject = require('instill')
const ipcMain = require('electron').ipcMain
const EventEmitter = require('events')
const helpers = require('./helpers')

/**
 * A proxy to allow access to releases by release
 * names instead of by game. This can be useful for listing
 * game releases all part of a release channel of the same name.
 *
 * @param {Object} exports - The module's exports attribute.
 * @returns {Proxy} Proxified module instance.
 * @private
 */
const makeReleaseProxy = function (exports) {
  return new Proxy(exports.games, {
    getOwnPropertyDescriptor: function (target, prop) {
      return {
        configurable: true,
        enumerable: true,
        value: this.get(target, prop),
      }
    },
    ownKeys: function (games) {
      const releases = []

      Object.keys(games).forEach(function (gameUid) {
        Object.keys(games[gameUid].releases).forEach(function (release) {
          if (!releases.includes(release)) {
            releases.push(release)
          }
        })
      })

      return releases
    },
    get: function (games, releaseName) {
      /* istanbul ignore next */
      if (releaseName === 'constructor') {
        return Object.constructor
      }

      const releases = Object.keys(games).filter(function (gameUid) {
        return !!games[gameUid].releases[releaseName]
      }).map(function (gameUid) {
        return games[gameUid].releases[releaseName]
      })

      if (releases.length > 0) {
        return releases
      }
    },
    set: function () {
      throw new Error('Registry.releases is read-only!')
    },
  })
}

const Registry = function () {
}
util.inherits(Registry, EventEmitter)
module.exports = exports = new Registry()

/* istanbul ignore next */
inject(exports, {
  fs: require('fs-extra'),
  app: require('../app'),
  logger: require('../logger'),
  repository: require('../updater/repository'),
  game: require('./game'),
  LOCAL_PLATFORM: helpers.getRepositoryPlatform(),
  remoteCommunication: require('../remoteCommunication'),
}, null, function onWith(exports) {
  exports.releases = makeReleaseProxy(exports)
  return exports
})

const REPOSITORY_LIST_FILENAME = 'repositories.json'

/**
 * @property {Repository} repository The current Repository object instance.
 */
exports.repository = null

/**
 * @property {Object} repositories Data for known repositories.
 */
exports.repositories = {}

/**
 * @property {Boolean} gamesLoaded Indicate if the games are loaded in memory.
 */
exports.gamesLoaded = false

/**
 * @property {Object} games Games currently loaded in memory.
 */
exports.games = {} // List by games

/**
 * @property {Object} releases Games, ordered by releases.
 */
exports.releases = makeReleaseProxy(exports)

/**
 * This will set up the different event listeners required
 * to keep track of repository updates, and then attempts to
 * read a local copy of the file. If a local copy cannot be found,
 * we will then try to load one from the repository.
 *
 * If all fails, we return an error. It is expected that the calling
 * code will need to re-attempt setup in such cases.
 *
 * @summary Initialize the registry.
 * @param {String} repositoryServer - HTTP/S URL to the remote repository.
 * @param {registry~setupCallback} callback - Callback function
 * @returns {undefined} void
 */
exports.setup = function (repositoryServer, callback) {
  const {
    repository,
    logger,
    remoteCommunication,
  } = this.modules

  // Set up repository an wait for update
  this.repository = repository.get(repositoryServer)
  this._repositoryUpdateCallback = this.onRepositoryUpdate.bind(this)
  this.repository.on('update', this._repositoryUpdateCallback)

  ipcMain.on(remoteCommunication.CHANNELS.GAME_LIST, (event) => {
    const games = {}
    Object.keys(this.games).forEach((gameUid) => {
      const game = this.games[gameUid]
      games[gameUid] = game.expose()
    })
    event.returnValue = games
  })

  /**
   * @callback registry~setupCallback
   * @param {Error|null} error - Error object (or null if no errors)
   */
  this.loadRepositoryListFile((error) => {
    if (error) {
      logger.warn('Failed to load local repository file:', error)
      return this.loadRepositoryDataFromRepository(callback)
    }

    try {
      const repositoryData = this.getRepositoryDataForCurrentRepository()
      this.parseRepositoryData(repositoryData, callback)
    } catch (error) {
      logger.warn('No data available for the current repository:', error)
      return this.loadRepositoryDataFromRepository(callback)
    }
  })
}

/**
 * @summary Clear all the data.
 * @return {undefined} void
 */
exports.clear = function () {
  this.repository.removeListener('update', this._repositoryUpdateCallback)
  this.unwatchRepository()

  Object.keys(this.games).forEach((key) => {
    this.games[key].destroy()
  })
  this.gamesLoaded = false
  this.games = {}
  this.repositories = {}
  this.repository = null
}

/**
 * Callback for repository update
 * @param {Any} repositoryData the repository data
 * @return {undefined} void
 */
exports.onRepositoryUpdate = function (repositoryData) {
  const {
    logger,
  } = this.modules

  this.update(repositoryData, (error) => {
    if (error) {
      logger.warn('Failed to store or parse update data received from the repository:', error)
    }
  })
}

/**
 * @summary Get the location of where data about repositories will be stored.
 * @returns {String} The path to where data for all know repositories are stored.
 */
exports.getRepositoriesPath = function () {
  const {
    app,
  } = this.modules

  return path.join(app.getPath('userData'), 'repositories')
}

/**
 * @summary Retrieve the path to the repositories list file.
 * @returns {String} The path to the file storing the latest repositories information.
 */
exports.getRepositoryListFilePath = function () {
  const filepath = this.getRepositoriesPath()
  return path.join(filepath, REPOSITORY_LIST_FILENAME)
}

/**
 * @summary Get the local folder for a given repository.
 * @param {String} repositoryName - name of the repository
 * @returns {String} The path to where a given repository's registry files are stored.
 */
exports.getRepositoryPath = function (repositoryName) {
  const filepath = this.getRepositoriesPath()
  return path.join(filepath, repositoryName)
}

/**
 * Note that this is unrelated to the location where a game
 * release will be stored; see `Release.location` instead to find
 * such path.
 *
 * This path instead relates to where releases and their data
 * will be stored on disk.
 *
 * @summary Retrieve the path to a given game's data on disk
 * @param {String} repositoryName - The name of the repository for the game.
 * @param {String} gameUid - The uid of the game.
 * @returns {String} Local file path to the game's registry file(s)
 */
exports.getGamePath = function (repositoryName, gameUid) {
  const repoPath = this.getRepositoryPath(repositoryName)
  return path.join(repoPath, gameUid)
}

/**
 * This will also automatically save the new data to disk.
 *
 * @summary Update the local repository data.
 * @param {Object} repositoryData - Data received from the currently used repository.
 * @param {registry~updateCallback} callback - callback function.
 * @returns {undefined} void
 */
exports.update = function (repositoryData, callback) {
  const {
    logger,
  } = this.modules

  this.setRepositoryDataForCurrentRepository(repositoryData)
  this.saveRepositoryListFile((error) => {
    /**
     * @callback registry~updateCallback
     * @param {Error|null} error - Error object (or null if no error)
     */
    if (error) {
      logger.error('Cannot save game list!', error)
      return callback(error)
    }

    this.parseRepositoryData(repositoryData, (error) => {
      callback(error)
    })
  })
}

/**
 * The process should also synchronise games and their releases whenever
 * necessary.
 *
 * @summary Parse the data from a repository and updates the in-memory structure.
 * @param {Object} repositoryData - Data received from the currently used repository.
 * @param {registry~parseRepositoryDataCallback} callback - callback function.
 * @returns {undefined} void
 */
exports.parseRepositoryData = function ({
  name: repositoryName,
  games,
}, callback) {
  const {
    LOCAL_PLATFORM,
  } = this.modules
  const removedGames = Object.keys(this.games)

  /**
   * @callback registry~parseRepositoryDataCallback
   * @param {Error|null} error - Error object (or null if no error)
   */
  const runner = helpers.createAsyncRunner(() => {
    this.gamesLoaded = true
    this.emit('gamesLoaded')
    callback()
  })

  // In case the repository has no releases yet
  games = games || {}

  // order the games
  let orderedGames = []
  Object.keys(games).forEach((gameUid) => {
    orderedGames.push({gameUid: gameUid, data: games[gameUid]})
  })

  orderedGames.sort((a, b) => {
    return a.data.order - b.data.order
  })

  // loop though the ordered games
  orderedGames.forEach(function (element) {
    const gameUid = element.gameUid

    const {
      assets,
      platforms,
      name: gameName,
      order: gameOrder,
      gameId,
    } = games[gameUid]

    const {
      meta: information,
    } = assets

    const gameData = {
      information,
      releases: platforms[LOCAL_PLATFORM],
    }

    if (!gameData.releases) {
      return
    } else if (!this.isGameExist(gameUid)) {
      runner.run(() => this.createGame(
        repositoryName,
        gameUid,
        gameId,
        gameOrder,
        gameName,
        gameData,
        runner.checkIfDone))
    } else {
      const index = removedGames.indexOf(gameUid)
      removedGames.splice(index, 1)
      runner.run(() => this.updateGame(gameUid, gameId, gameOrder, gameName, gameData, runner.checkIfDone))
    }
  }, this)

  removedGames.forEach((gameUid) => {
    runner.run(() => this.markGameAsRemoved(gameUid, runner.checkIfDone))
  })

  runner.checkIfDone()
}

/**
 * @summary Retrieve the local data for a given repository.
 * @param {String} server - The server name for the repository.
 * @returns {Object} Repository data
 */
exports.getRepositoryData = function (server) {
  const repositoryData = this.repositories[server]

  if (!repositoryData) {
    throw new Error(`No repository data for: ${server}`)
  }

  return repositoryData
}

/**
 * @summary Retrieve the local data for the repository currently in use.
 * @returns {Object} Repository data
 */
exports.getRepositoryDataForCurrentRepository = function () {
  const {
    server,
  } = this.repository

  return this.getRepositoryData(server)
}

/**
 * @summary Set local data for a given repository.
 * @param {String} server - The server name for the repository.
 * @param {Object} data - Data to set for a given server.
 * @returns {undefined} void
 */
exports.setRepositoryData = function (server, data) {
  this.repositories[server] = data
}

/**
 * @summary Set local data for the repository currently in use.
 * @param {Object} data - Data received from the currently used repository.
 * @returns {undefined} void
 */
exports.setRepositoryDataForCurrentRepository = function (data) {
  const {
    server,
  } = this.repository

  this.setRepositoryData(server, data)
}

/**
 * @summary Check if a game by a given name exists in the registry.
 * @param {String} gameUid - The uid of the game to verify the existence of.
 * @returns {boolean} True if the game exists.
 */
exports.isGameExist = function (gameUid) {
  return !!this.games[gameUid]
}

/**
 * @summary Get a game from the registry by name.
 * @param {String} gameUid - The uid of the game to fetch.
 * @returns {Game} Game object instance.
 */
exports.getGame = function (gameUid) {
  const game = this.games[gameUid]

  if (!game) {
    throw new Error(`Game does not exist: ${gameUid}`)
  }

  return game
}

/**
 * @summary Callback when assets are loaded from a game
 * @param {Object} game - the game from which the assets have been loaded
 * @param {String} releaseName - the name of the release from which the assets have been loaded
 * @return {undefined} void
 */
exports.onGameAssetsLoadedEventHandler = function (game, releaseName) {
  this.emit('gameAssetsLoaded', game.name, releaseName)
}

/**
 * This creates an empty game instance, will all values for it and
 * its releases set as default. Use `updateGame` to update
 * the newly created game's data.
 *
 * @summary Create a game.
 * @param {String} repositoryName - The name of the repository for which to create a game for.
 * @param {String} gameUid - The uid of the game to create.
 * @param {Number} gameId - The id of the game to create.
 * @param {Number} gameOrder - The order of the game to create.
 * @param {String} gameName - The name of the game to create.
 * @param {Object} gameData - The data for the game.
 * @param {registry~updateGameCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.createGame = function (repositoryName, gameUid, gameId, gameOrder, gameName, gameData, callback) {
  const {
    game,
    fs,
    remoteCommunication,
  } = this.modules

  const filepath = this.getGamePath(repositoryName, gameUid)
  fs.mkdirpSync(filepath)
  const gameInstance = game.get(this.repository, gameUid, gameId, gameOrder, gameName, filepath)
  gameInstance.on('gameAssetsLoaded', this.onGameAssetsLoadedEventHandler.bind(this))
  this.games[gameUid] = gameInstance

  gameInstance.update(gameId, gameOrder, gameName, gameData, () => {
    remoteCommunication.send(remoteCommunication.CHANNELS.GAME_ADDED, gameInstance.expose())
    callback()
  })
}

/**
 * Note that some processes happen asynchronously; namely, updating
 * release information is an asynchronous process. This is why we
 * need a callback function here.
 *
 * @summary Update a game.
 * @param {String} gameUid - The uid of the game to update.
 * @param {Number} gameId - The id of the game to create.
 * @param {Number} gameOrder - The order of the game to create.
 * @param {String} gameName - The name of the game to create.
 * @param {Object} gameData - The data for the game.
 * @param {registry~updateGameCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.updateGame = function (gameUid, gameId, gameOrder, gameName, gameData, callback) {
  const {
    remoteCommunication,
  } = this.modules

  const gameInstance = this.getGame(gameUid)
  const oldSerializedGameInstance = JSON.stringify(gameInstance.expose())

  /**
   * @callback registry~updateGameCallback
   * @param {Error|null} error Error object (or null if no errors)
   */
  gameInstance.update(gameId, gameOrder, gameName, gameData, () => {
    if (oldSerializedGameInstance !== JSON.stringify(gameInstance.expose())) {
      remoteCommunication.send(remoteCommunication.CHANNELS.GAME_UPDATED, gameInstance.expose())
    }
    callback()
  })
}

/**
 * The game will automatically be removed if no releases are left in it.
 * However, installed releases won't be removed until the release is uninstalled.
 *
 * @summary Mark a game for removal.
 * @param {String} gameUid - The uid of the game to mark for removal.
 * @param {Function} callback - Callback function.
 * @returns {undefined} void
 */
exports.markGameAsRemoved = function (gameUid, callback) {
  const game = this.getGame(gameUid)

  game.markAllReleasesAsRemoved()
  const releasesCount = Object.keys(game.releases).length

  if (releasesCount === 0) {
    this.removeGame(gameUid)
  }

  callback()
}

/**
 * This should be called when:
 *
 *   1. A game marked for removal has no installed releases.
 *   2. A game has its last installed release uninstalled and is marked for removal.
 *
 * @summary Remove the game and delete it from disk.
 * @param {String} gameUid - The uid of the game to update.
 * @returns {undefined} void
 */
exports.removeGame = function (gameUid) {
  const {
    fs,
    remoteCommunication,
  } = this.modules

  const gameInstance = this.getGame(gameUid)
  remoteCommunication.send(remoteCommunication.CHANNELS.GAME_REMOVED, gameInstance.expose())
  delete this.games[gameUid]

  fs.removeSync(gameInstance.filepath)
}

/**
 * We store data from all known repositories in a single file. This allows for:
 *
 *   1. Repository relocation.
 *   2. Starting Zaap pointing to a different registry.
 *
 * @summary Load data for all known repositories.
 * @param {registry~loadRepositoryListFileCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.loadRepositoryListFile = function (callback) {
  const {
    fs,
  } = this.modules

  /**
   * @callback registry~loadRepositoryListFileCallback
   * @param {Error|null} error - Error object (or null if no error)
   */
  const filepath = this.getRepositoryListFilePath()
  fs.readFile(filepath, (error, data) => {
    if (error) {
      return callback(error)
    }

    try {
      this.repositories = JSON.parse(data)
    } catch (error) {
      return callback(error)
    }

    callback()
  })
}

/**
 * @summary Save the repositories data to disk.
 * @param {registry~saveRepositoryListFileCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.saveRepositoryListFile = function (callback) {
  const {
    fs,
  } = this.modules
  const dirpath = this.getRepositoriesPath()
  const filepath = this.getRepositoryListFilePath()

  fs.mkdirpSync(dirpath)

  /**
   * @callback registry~saveRepositoryListFileCallback
   * @param {Error|null} error - Error object (or null if no error)
   */
  fs.writeFile(filepath, JSON.stringify(this.repositories), callback)
}

/**
 * This will normally be called whenever we point Zaap to use a registry for
 * the first time. Once we have receive the initial data, we should normally
 * simply access the local data, and instead watch the repository for updates.
 *
 * @summary Fetch the file from a remote repository and update its local data.
 * @param {registry~loadRepositoryDataFromRepositoryCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.loadRepositoryDataFromRepository = function (callback) {
  /**
   * @callback registry~loadRepositoryDataFromRepositoryCallback
   * @param {Error|null} error - Error object (or null if no error)
   */
  this.repository.getGamesList().then((repositoryData) => {
    this.update(repositoryData, callback)
  }).catch(callback)
}

/**
 * Watch will start the repository watch interval; whenever
 * changes are detected, we will receive them through
 * repository.on('update'). See `registry.setup` for more details.
 *
 * @summary Watch the repository for updates.
 * @returns {undefined} void
 */
exports.watchRepository = function () {
  const repositoryData = this.getRepositoryDataForCurrentRepository()
  this.repository.watch(repositoryData)
}

/**
 * @summary Unwatch the repository for updates.
 * @returns {undefined} void
 */
exports.unwatchRepository = function () {
  this.repository.unwatch()
}
