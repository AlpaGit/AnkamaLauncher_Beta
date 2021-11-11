const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')

/**
 * @summary UpdateActionCheckConfiguration
 */
class UpdateActionCheckConfiguration extends UpdateAction {
  /**
  * @summary create promise
  * @returns {ControllablePromise} void
  */
  createPromise() {
    const {
      checkConfiguration,
    } = this.dependencies

    const {
      location,
      configuration,
    } = this

    return new ControllablePromise((resolve, reject) => {
      checkConfiguration(location, configuration)
        .then(resolve)
        .catch(reject)
    })
  }
}

module.exports = UpdateActionCheckConfiguration
