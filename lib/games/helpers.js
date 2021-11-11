/**
 * Set of helper functions used internally.
 *
 * @module zaap/games/helpers
 */
const inject = require('instill')
inject(exports, {
  platform: process.platform,
})

/**
 * @summary Returns the name of the local platform.
 * @returns {String} The name of the platform (windows, darwin or linux)
 */
exports.getRepositoryPlatform = function () {
  const {
    platform,
  } = this.modules

  if (platform === 'win32') {
    return 'windows'
  }

  return platform
}

/**
 * Errors are currently ignored...
 *
 * @summary Create a helper for dealing with concurrent asynchronous operations.
 * @param {Function} callback - Function to call once all the calls have been completed
 * @returns {Object} Async Runner helper
 */
exports.createAsyncRunner = function (callback) {
  let running = 1

  return {
    run(call) {
      running += 1
      call()
    },
    checkIfDone() {
      running -= 1
      running === 0 && callback()
    },
  }
}
