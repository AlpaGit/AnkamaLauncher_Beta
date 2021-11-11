const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const helpers = require('../../games/helpers')
const PLATFORM = helpers.getRepositoryPlatform()
const { types: updateTypes } = require('../update')

/**
 * @summary UpdateActionGetRemoteHashes
 */
class UpdateActionGetRemoteHashes extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} Promise
   */
  createPromise() {
    const {
      repository,
      gameUid,
      releaseName,
      version,
    } = this

    return new ControllablePromise((resolve, reject) => {
      const isPreInstall = this.params.updateType === updateTypes.PRE_INSTALL

      const args = [gameUid, releaseName, PLATFORM, version]

      const hashesPromise = isPreInstall
        ? repository.getReleaseConfig(...args)
        : repository.getRelease(...args)

      hashesPromise
        .then(resolve)
        .catch(reject)
    })
  }
}

module.exports = UpdateActionGetRemoteHashes
