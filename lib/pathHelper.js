/**
 * Some helpers which manipulate folder trees
 *
 * @module zaap/pathHelper
 */
const path = require('path')
const inject = require('instill')
const logger = require('./logger')
const updateHelper = require('./updater/helpers/updateHelper')

// Errors
const {
  errors,
  ZaapError,
} = require('./errors').register('PATH_HELPER', {
  LOCATION_IS_A_GAME_DIRECTORY: 11000,
  LOCATION_NOT_FOUND: 11001,
  LOCATION_NOT_A_DIRECTORY: 11002,
  LOCATION_NOT_EMPTY: 11003,
})

/* istanbul ignore next */
inject(exports, {
  fs: require('fs'),
  getRegistry: () => require('./games/registry'),
})

/**
 * @summary Return path if it exists, or the first existing parent path
 * @param {string} pathToCheck - the path to check
 * @returns {string} the first existing path
 */
exports.findExistingParent = function (pathToCheck) {
  const {
    fs,
  } = this.modules

  let lastPathToCheck = ''

  do {
    if (fs.existsSync(pathToCheck)) {
      return pathToCheck
    }

    if (path.parse(pathToCheck).root === pathToCheck
      || pathToCheck === '.'
      || path.resolve(pathToCheck) === lastPathToCheck
    ) {
      throw new Error('cannot find any existing path')
    }

    lastPathToCheck = path.resolve(pathToCheck)
    pathToCheck = path.join(pathToCheck, '..')
  } while (true)
}

/**
 * This function is used to confirm that no releases will install
 * each others in their respective locations. This function must:
 *
 *   1. Make sure I cannot install a release in another release's folder
 *      or folder
 *   2. If my folder is not empty, that there are no games installed in
 *      any of the folders
 *
 * @summary Find if a the location specified is in a release install folder.
 * @param {String} location - The location on disk to verify
 * @param {String} compareGameUid - The gameUid to compare with
 * @param {String} compareReleaseName - The releaseName to compare with
 * @returns {boolean} true if the location is in a game install folder
 */
exports.isLocationAGameFolder = function (location, compareGameUid, compareReleaseName) {
  const registry = this.modules.getRegistry()
  const releases = Object.values(registry.games).reduce((acc, game) => acc.concat(Object.values(game.releases)), [])

  const arePathsEquals = (path1, path2) => path.normalize(path1) === path.normalize(path2)
  const isNotSameRelease = (release) => release.gameUid !== compareGameUid || release.name !== compareReleaseName

  return releases.some((release) => release.location && (
    isSubdirOf(location, release.location) ||
    isNotSameRelease(release) && arePathsEquals(location, release.location)
  ))
}

/**
 * @summary Check if a folder is a subfolder of another
 * @param {String} childPath - Path of the child folder
 * @param {String} parentPath - Path of the parent folder
 * @returns {Boolean} true childPath is a subfolder of parentPath
 */
const isSubdirOf = (childPath, parentPath) => {
  const normalizedChild = path.normalize(childPath)
  const normalizedParent = path.normalize(parentPath)
  if (normalizedChild === normalizedParent) {
    return false
  }
  return normalizedChild.startsWith(normalizedParent + path.sep)
}

/**
 * This function is used to detect if the folder contains an old
 * install of the same release
 *
 * @summary Check if the folder contains an old install of the same release
 * @param {String} location - The location on disk to verify
 * @param {String} compareGameUid - The gameUid to compare with
 * @param {String} compareReleaseName - The releaseName to compare with
 * @returns {boolean} true if the location is an old install of the same release
 */
exports.isLocationTheSameRelease = function (location, compareGameUid, compareReleaseName) {
  const {
    fs,
  } = this.modules

  try {
    const releaseInfos = fs.readFileSync(path.join(location, updateHelper.releaseInfosFileName))
    const {
      gameUid,
      release,
    } = JSON.parse(releaseInfos)

    return gameUid === compareGameUid && release === compareReleaseName
  } catch (error) {
    logger.warn(`Failed to load/parse release info file:`, error.message)
  }

  return false
}

/**
 * @summary Verifies if the location exist
 * @param {String} location - folder location
 * @returns {boolean} true if present and accessible
 */
exports.isLocationExist = function (location) {
  const {
    fs,
  } = this.modules

  try {
    fs.accessSync(location)
    return true
  } catch (error) {
    return false
  }
}

/**
 * @summary Verifies if the location is a directory
 * @param {String} location - folder location
 * @returns {boolean} true if present and accessible
 */
exports.isLocationADirectory = function (location) {
  const {
    fs,
  } = this.modules

  const stat = fs.statSync(location)
  return stat.isDirectory()
}

/**
 * @summary Verifies if a folder is empty
 * @param {String} location - folder location
 * @returns {boolean} true if present, accessible and empty
 */
exports.isLocationEmpty = function (location) {
  const {
    fs,
  } = this.modules

  return fs.readdirSync(location).length === 0
}


/**
 * This will throw an error if the location is non-installable.
 *
 * @summary Check if a destination location can be an install location
 * @param {String} location - Location to verify
 * @param {String} gameUid - The gameUid to compare with
 * @param {String} releaseName - The releaseName to compare with
 * @returns {undefined} void
 */
exports.checkIfLocationIsInstallable = function (location, gameUid, releaseName) {
  const {
    LOCATION_IS_A_GAME_DIRECTORY,
    LOCATION_NOT_FOUND,
    LOCATION_NOT_A_DIRECTORY,
    LOCATION_NOT_EMPTY,
  } = errors

  if (this.isLocationAGameFolder(location, gameUid, releaseName)) {
    throw new ZaapError(
      LOCATION_IS_A_GAME_DIRECTORY,
      'Cannot install a game in the folder of another game',
      'release.error.cannotInstallInFolderOfAnotherGame'
    )
  }

  if (this.isLocationExist(location) === false) {
    throw new ZaapError(
      LOCATION_NOT_FOUND,
      'Cannot install a game in a non-existing folder',
      'release.error.cannotInstallInNonExistingFolder'
    )
  }

  if (this.isLocationADirectory(location) === false) {
    throw new ZaapError(
      LOCATION_NOT_A_DIRECTORY,
      'Cannot install a game, location is not a folder',
      'release.error.cannotInstallLocationIsNotAFolder'
    )
  }

  if (!this.isLocationTheSameRelease(location, gameUid, releaseName) && !this.isLocationEmpty(location)) {
    throw new ZaapError(
      LOCATION_NOT_EMPTY,
      'Cannot install a game in a non-empty folder',
      'release.error.cannotInstallInANonEmptyFolder'
    )
  }
}

/**
 * @summary Check if a destination location can be read/write
 * @param {String} location The path to test
 * @returns {Boolean} true if user can read/write, false otherwise
 */
exports.hasReadWritePermissions = function (location) {
  const {
    fs,
  } = this.modules

  const testFilePath = path.join(location, 'test')

  try {
    const fd = fs.openSync(testFilePath, 'w+')
    fs.closeSync(fd)
    fs.unlinkSync(testFilePath)

    return true
  } catch (error) {
    if (error.code === 'ENOENT') {
      // if the location doesn't exists, check the parent (if location is not the root directory)
      if (path.parse(location).root === location || location === '.') {
        return false
      }

      return this.hasReadWritePermissions(path.join(location, '..'))
    }

    return false
  }
}
