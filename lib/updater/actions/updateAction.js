const ACTION_PREFIX = 'UpdateAction'

/**
 * @summary UpdateAction
 */
class UpdateAction  {
  /**
   * @summary Constructor
   * @param {repository.Repository} repository - The repository to get the update from
   * @param {String} gameUid - gameUid of the game's release to update
   * @param {String} releaseName - name of the release to update
   * @param {String} version - version of the release to update to
   * @param {Configuration} configuration - configuration of the release to update
   * @param {String} location - where to execute the update
   * @param {Object} dependencies - dependencies of the action
   * @param {Object} params - parameters of the action
   */
  constructor(repository, gameUid, releaseName, version, configuration, location, dependencies, params) {
    if (new.target === UpdateAction) {
      throw new TypeError('Cannot instantiate UpdateAction directly')
    }

    this.repository = repository
    this.gameUid = gameUid
    this.releaseName = releaseName
    this.version = version
    this.configuration = configuration
    this.location = location
    this.dependencies = dependencies
    this.params = params
  }

  /**
   * @summary start
   * @returns {ControllablePromise} void
   */
  start() {
    this.promise = this.createPromise()
    return this.promise
  }

  /**
   * @summary create promise
   * @returns {ControllablePromise} the created promise
   */
  createPromise() {
    throw new Error('createPromise not implemented')
  }

  /**
   * @summary pause
   * @returns {Promise} void
   */
  pause() {
    return this.promise.pause()
  }

  /**
   * @summary resume
   * @returns {Promise} void
   */
  resume() {
    return this.promise.resume()
  }

  /**
   * @summary cancel
   * @returns {Promise} void
   */
  cancel() {
    return this.promise.cancel()
  }

  /**
   * @summary Returns the type of the action
   * @returns {String} Type of the action
   */
  get type() {
    return this.constructor.name
  }

  /**
   * @summary Check if the action is an instance of the specifed type
   * @param {String} type - the type to check. It does not need to start with UpdateAction
   * @returns {Boolean} true if the action is an instance of the specified type
   */
  checkType(type) {
    if (!type.startsWith(ACTION_PREFIX)) {
      type = ACTION_PREFIX + type
    }
    return this.type === type
  }
}

module.exports = UpdateAction
