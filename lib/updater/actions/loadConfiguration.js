const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')

/**
 * @summary UpdateActionLoadConfiguration
 */
class UpdateActionLoadConfiguration extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} Promise
   */
  createPromise() {
    return new ControllablePromise((resolve) => {
      this.configuration.load()
      resolve()
    })
  }
}

module.exports = UpdateActionLoadConfiguration
