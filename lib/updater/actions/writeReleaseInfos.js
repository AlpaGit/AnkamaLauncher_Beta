const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const path = require('path')
const updateHelper = require('../helpers/updateHelper')

/**
 * @summary UpdateActionSaveHashes
 */
class UpdateActionWriteReleaseInfos extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} void
   */
  createPromise() {
    const {
      fs,
      logger,
    } = this.dependencies

    return new ControllablePromise((resolve) => {
      fs.writeFile(this.getReleaseInfosFilePath(), this.createFileData(), (error) => {
        if (error) {
          logger.warn('update: unable to write releases info', error)
        }

        resolve()
      })
    })
  }

  /**
   * @summary Returns the path to the release infos file
   * @returns {String} The path to the release infos file
   */
  getReleaseInfosFilePath() {
    return path.join(this.location, updateHelper.releaseInfosFileName)
  }

  /**
   * @summary Returns the data that will be saved to the file
   * @returns {String} Data that will be saved to the file
   */
  createFileData() {
    return JSON.stringify({
      gameUid: this.gameUid,
      release: this.releaseName,
    })
  }
}

module.exports = UpdateActionWriteReleaseInfos
