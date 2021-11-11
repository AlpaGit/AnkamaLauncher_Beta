const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')

/**
 * @summary UpdateActionClearEmptyDirectories
 */
class UpdateActionClearEmptyDirectories extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} void
   */
  createPromise() {
    const {
      deleteEmpty,
    } = this.dependencies

    return new ControllablePromise((resolve) => {
      deleteEmpty(this.location, () => {
        resolve()
      })
    })
  }
}

module.exports = UpdateActionClearEmptyDirectories
