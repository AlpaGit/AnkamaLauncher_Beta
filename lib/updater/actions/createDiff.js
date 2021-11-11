const DiffHelper = require('../helpers/diffHelper')
const ControllablePromise = require('../../controllablePromise')
const UpdateAction = require('./updateAction')

/**
 * @summary UpdateActionCreateDiff
 */
class UpdateActionCreateDiff extends UpdateAction {
  /**
   * @param {*} args - Arguments
   */
  constructor(...args) {
    super(...args)

    const {
      fragments,
      localHashes,
      remoteHashes,
    } = this.params

    this.diffHelper = new DiffHelper(fragments, localHashes, remoteHashes, this.dependencies)
  }

  /**
   *
   * @param {*} args - Arguments
   * @returns {ControllablePromise<Object>} Resolve the diff when created
   */
  createPromise(...args) {
    return new ControllablePromise((resolve) => {
      this.diffHelper.createPromise(...args).then(resolve)
    })
  }
}

module.exports = UpdateActionCreateDiff
