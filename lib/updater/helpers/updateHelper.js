
const path = require('path')
const inject = require('instill')
const { promisify } = require('es6-promisify')

/* istanbul ignore next */
inject(exports, {
  fs: require('fs'),
})

/**
 * @summary verify that all requested fragments are available.
 * @param {string[]} fragments - Fragments we wish to receive.
 * @param {Object} remote - The game data we received from the repository.
 * @return {undefined} void
 * @private
 */
exports.verifyFragmentsList = (fragments, remote) => {
  fragments.forEach((fragment) => {
    if (!remote[fragment]) {
      throw new Error(`Fragment ${fragment} was requested but not found in this version.`)
    }
  })
}

/**
 * Find whether a given filename is to be downloaded
 *
 * @param {*} fragmentsToDownload key/value of fragments to download
 * @param {*} fileName file name to search for in the list of fragments
 * @return {boolean} true if the given file was found in any of the fragments
 */
exports.isFileMarkedForDownload = (fragmentsToDownload, fileName) => {
  // Check whether we are going to be downloading
  // this file in a different fragment
  for (let fragmentName in fragmentsToDownload) {
    const fileToDownload = fragmentsToDownload[fragmentName].files[fileName]

    if (fileToDownload) {
      return true
    }
  }

  return false
}

/**
 * Create an empty file entry which marks the
 * file to be deleted.
 *
 * @private
 *
 * @return {Object} emptyFile - an empty file entry.
 */
exports.createDeletedFile = () => {
  return {
    size: 0,
    hash: null,
  }
}

/**
 * Calculate the total byte size of an update.
 *
 * @private
 * @param {Object} gameData - Game data.
 * @return {Object} totalSize - The total byte size of the update.
 */
exports.calculateUpdateSize = function (gameData) {
  let totalSize = 0
  let totalFiles = 0
  let fragmentsSize = []

  for (let name in gameData) {
    let fragment = gameData[name]
    let fragmentSize = 0

    for (let filename in fragment.files) {
      const file = fragment.files[filename]
      if (file.download) {
        fragmentSize += fragment.files[filename].size
        totalFiles += 1
      }
    }

    fragmentsSize.push({
      name,
      fragmentSize,
    })

    totalSize += fragmentSize
  }

  return {
    totalSize,
    fragmentsSize,
    totalFiles,
  }
}

/**
 * @summary Read and parse the '.release.hashes.json' file.
 * @param {Object} location - Path to the update folder.
 * @return {Promise<Object>} Promises that fulfills the hashes object, when the json file is parsed.
 */
exports.getLocalHashes = function (location) {
  const {
    fs,
  } = this.modules

  const hashesFilePath = path.join(location, this.hashesFileName)
  return promisify(fs.readFile)(hashesFilePath).then(JSON.parse)
}

exports.hashesFileName = '.release.hashes.json'
exports.releaseInfosFileName = '.release.infos.json'
