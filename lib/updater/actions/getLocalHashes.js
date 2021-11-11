const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const logger = require('../../logger')

/**
 * @class LocalHashesError
 * @extends {Error}
 */
class LocalHashesError extends Error {
  /**
   * Creates an instance of LocalHashesError
   */
  constructor() {
    super('Cannot get local hashes')
    this.name = 'LocalHashesError'
  }
}

/**
 * @summary UpdateActionGetLocalHashes
 */
class UpdateActionGetLocalHashes extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} Promise
   * @throws {LocalHashesError}
   */
  createPromise() {
    return new ControllablePromise((resolve, reject) => {
      if (this.params.fromScratch) {
        resolve({})
        return
      }

      const {
        updateHelper,
      } = this.dependencies

      updateHelper.getLocalHashes(this.location)
        .then((hashes) => {
          if (hashes.configuration.hasOwnProperty('Files')) {
            logger.info(`updateHelper: release.hashes.json uses cytrus v4 upper camel case keys`)
            reject(new LocalHashesError())
          } else {
            resolve(hashes)
          }
        })
        .catch((error) => {
          logger.warn(`updateHelper: Cannot get local hashes`, error)
          reject(new LocalHashesError())
        })
    })
  }
}

module.exports = UpdateActionGetLocalHashes
module.exports.LocalHashesError = LocalHashesError
