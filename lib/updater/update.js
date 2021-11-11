const arrayHelper = require('../arrayHelper')
const EventEmitter = require('events')
const updateHelper = require('./helpers/updateHelper')
const remoteCommunication = require('../remoteCommunication')

const ACTION_TYPES = require('./actions/updateActionTypes')
const CONFIGURATION_FRAGMENT = 'configuration'
const SAVE_HASHES_INTERVAL_IN_MS = 10000
const SEND_PROGRESS_BY_IPC_IN_MS = 500

// Download speed
// values are chosen to balance between
// display reactivity and display "continuousness" (no sudden jumps)
const DOWNLOAD_SPEED_BUCKET_DURATION_MS = 100
const DOWNLOAD_SPEED_MAX_AGE = 1500

const UPDATE_TYPES = {
  INSTALL: Symbol('INSTALL'),
  UPDATE: Symbol('UPDATE'),
  REPAIR: Symbol('REPAIR'),
  PRE_INSTALL: Symbol('PRE_INSTALL'),
}

let updateId = 0

/**
 * @summary Update
 */
class Update extends EventEmitter {
  /**
   * @summary Returns the different types of update
   * @returns {Object} the different types of update
   */
  static get types() {
    return UPDATE_TYPES
  }

  /**
   * @summary Returns the download speed buckets duration
   * @returns {Number} the download speed buckets duration
   */
  static get downloadSpeedBucketsDuration() {
    return DOWNLOAD_SPEED_BUCKET_DURATION_MS
  }

  /**
   * @summary Returns the download speed max age
   * @returns {Number} the download speed max age
   */
  static get downloadSpeedMaxAge() {
    return DOWNLOAD_SPEED_MAX_AGE
  }

  /**
   * @summary Constructor
   * @param {Symbol} type - The type of the update
   * @param {Repository} repository - The repository to get the update from
   * @param {String} gameUid - gameUid of the game's release to update
   * @param {String} releaseName - name of the release to update
   * @param {String} version - version of the release to update to
   * @param {Configuration} configuration - configuration of the release to update
   * @param {String} location - where to execute the update
   * @param {Boolean} isPausedByUser - indicate if the update is paused by user
   */
  constructor(
    type,
    repository,
    gameUid,
    releaseName,
    version,
    configuration,
    location,
    isPausedByUser = false,
    {
      updateQueue,
      actionFactory,
      logger,
      getDateNow = () => Date.now(),
      fromScratch,
    } = {}
  ) {
    super()

    if (!updateQueue) {
      throw new Error('update: updateQueue dependency not specified')
    }

    if (!actionFactory) {
      throw new Error('update: actionFactory dependency not specified')
    }

    if (!logger) {
      throw new Error('update: logger dependency not specified')
    }

    this.id = updateId += 1

    this._isRunning = false
    this._isPaused = isPausedByUser
    this._isPausedByUser = isPausedByUser
    this._isStopped = false
    this._currentAction = null

    this._updateQueue = updateQueue
    this._actionFactory = actionFactory
    this._logger = logger
    this.getDateNow = getDateNow
    this.fromScratch = fromScratch

    this.isQueued = true
    this.type = type
    this.repository = repository
    this.gameUid = gameUid
    this.releaseName = releaseName
    this.version = version
    this.configuration = configuration
    this.location = location
    this.remoteHashes = {}
    this.localHashes = {}
    this.repairProgress = {}
    this.downloadProgress = {}
    this.overallDownloadProgress = {
      downloadedSize: 0,
      totalSize: 0,
    }
    this.alreadyDownloadedSize = 0
    this.downloadedHashes = {}
    this.downloadedArchives = {}
    this.deletedFiles = {}
    this.diff = {}
    this.setFragments(configuration.fragments)

    this.downloadSpeed = 0
    this.downloadSpeedBuckets = []

    this.averageSpeed = 0
    this.downloadSpeedCount = 0

    this.configurationCallback = this.onConfigurationUpdate.bind(this)
    this.configuration.on('update', this.configurationCallback)

    if (this.type === UPDATE_TYPES.PRE_INSTALL) {
      this.start()
    } else {
      this._updateQueue.add(this)
    }
  }

  /**
   * @summary Get fragments
   * @returns {Array} fragments
   */
  get fragments() {
    return this._fragments
  }

  /**
   * @summary Set fragments
   * @param {Array} fragments - fragments
   * @returns {undefined} void
   */
  setFragments(fragments = []) {
    if (arrayHelper.equalsIgnoreOrder(fragments, this._fragments)) {
      return
    }

    this._fragments = fragments

    if (this.isRunning) {
      this._isUpdatingFragments = true
      const cancelCurrentAction = this.currentActionCanBeCanceledOnFragmentsChange()
      this.clearQueueOnFragmentsChange()
      this.clearDownloadProgress()
      this.createActionsOnFragmentsChange()

      this.alreadyDownloadedSize = this.overallDownloadProgress.downloadedSize

      // cancel the current action at the end so the newly created actions will start
      if (cancelCurrentAction) {
        this.cancelCurrentAction()
          .then(() => {
            this._isUpdatingFragments = false
          })
      } else {
        this._isUpdatingFragments = false
      }
    }
  }


  /**
   * Add downloaded size to current download speed step to compute the download speed
   * @param {Number} bytes number of downloaded bytes
   * @return {undefined} void
   */
  addDownloadedBytes(bytes) {
    const now = this.getDateNow()
    // calculate rounded time in order to group bytes in buckets.
    const dateNowRound = DOWNLOAD_SPEED_BUCKET_DURATION_MS *
        Math.round(now / DOWNLOAD_SPEED_BUCKET_DURATION_MS)
    let currentBucket = {bytes: bytes, time: dateNowRound}

    // downloaded bytes are accumulated in time buckets of DOWNLOAD_SPEED_BUCKET_DURATION_MS ms
    if (this.downloadSpeedBuckets.length > 0) {
      let lastBucket = this.downloadSpeedBuckets[this.downloadSpeedBuckets.length - 1]
      if (lastBucket.time === dateNowRound) { // an existing bucket matches current rounded-time
        lastBucket.bytes += bytes
      } else {
        this.downloadSpeedBuckets.push(currentBucket) // create a new bucket
      }

      // cut old values away
      this.downloadSpeedBuckets = this.downloadSpeedBuckets.filter((bucket) => {
        return dateNowRound - bucket.time < DOWNLOAD_SPEED_MAX_AGE
      })
    } else {
      this.downloadSpeedBuckets.push(currentBucket)
    }
  }

  /**
   * Compute download speed in bytes/second
   * @return {Number} the download speed
   */
  computeDownloadSpeed() {
    // calculate rounded time in order to group bytes in buckets.
    const dateNowRound = DOWNLOAD_SPEED_BUCKET_DURATION_MS *
        Math.round(this.getDateNow() / DOWNLOAD_SPEED_BUCKET_DURATION_MS)

    // no buckets: 0 b/s
    if (this.downloadSpeedBuckets.length === 0) {
      this.downloadSpeed = 0
      return this.downloadSpeed
    }

    const minTime = this.downloadSpeedBuckets[0].time
    let deltaTime = dateNowRound - minTime
    // we can't have deltaTime === 0. The case in which we have only one bucket doesn't mean
    // we have a deltaTime of 0 ms, but probabilistically DOWNLOAD_SPEED_BUCKET_DURATION_MS / 2 ms.
    if (deltaTime <= 0) {
      deltaTime = DOWNLOAD_SPEED_BUCKET_DURATION_MS / 2
    }

    let totalBytes = 0
    this.downloadSpeedBuckets.forEach((bucket) => {
      totalBytes += bucket.bytes
    })

    // Compute average speed
    this.downloadSpeed = 1000 * totalBytes / deltaTime
    this.averageSpeed = (this.averageSpeed * this.downloadSpeedCount + this.downloadSpeed) /
      (this.downloadSpeedCount + 1)
    this.downloadSpeedCount += 1

    return this.downloadSpeed
  }

  /**
   * @summary Clear the queue when fragments change
   * @returns {undefined} void
   */
  clearQueueOnFragmentsChange() {
    for (let i = this._actionsQueue.length - 1; i >= 0; i--) {
      const action = this._actionsQueue[i]
      if (Update.actionCanBeCanceledOnFragmentsChange(action.type)) {
        this._actionsQueue.splice(i, 1)
      }
    }
  }

  /**
   * @summary Create and queue the actions needed when fragments change
   * @returns {undefined} void
   */
  createActionsOnFragmentsChange() {
    if (this.type !== UPDATE_TYPES.PRE_INSTALL) {
      this.createSaveHashesOnFragmentsChange()
      this.createDiffActions()
      this.createFragmentDownloadActions()
      this.createFinalActions()
    }
  }

  /**
   * @summary Create and queue the save hashes action when fragments change
   * @returns {undefined} void
   */
  createSaveHashesOnFragmentsChange() {
    const {
      _currentAction: currentAction,
    } = this

    if (currentAction && currentAction.checkType(ACTION_TYPES.DOWNLOAD_FRAGMENT)) {
      this.processDownloadFragmentActionResult(
        currentAction.params.fragment,
        currentAction.downloadedFiles,
        currentAction.downloadedArchives
      )
    }
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.SAVE_HASHES))
  }

  /**
   * @summary Return true if the current action must be canceled when fragments has changed
   * @returns {Boolean} True if the current action must be canceled when fragments has changed
   */
  currentActionCanBeCanceledOnFragmentsChange() {
    if (this._currentAction.checkType(ACTION_TYPES.DOWNLOAD_FRAGMENT)) {
      return this._currentAction.params.fragment !== CONFIGURATION_FRAGMENT
    }

    if (this._currentAction.checkType(ACTION_TYPES.CREATE_DIFF)) {
      const fragments = this._currentAction.params.fragments
      return fragments.length !== 1 || fragments[0] !== CONFIGURATION_FRAGMENT
    }

    return Update.actionCanBeCanceledOnFragmentsChange(this._currentAction.type)
  }

  /**
   * @summary Return true if the action of type can be canceled when fragments has changed
   * @param {String} type - action type
   * @returns {Boolean} True if the action type can be canceled when fragments has changed
   */
  static actionCanBeCanceledOnFragmentsChange(type) {
    const nonCancelableTypes = [
      ACTION_TYPES.GET_REMOTE_HASHES,
      ACTION_TYPES.LOAD_CONFIGURATION,
      ACTION_TYPES.CHECK_CONFIGURATION,
      ACTION_TYPES.WRITE_RELEASE_INFOS,
    ]

    return !nonCancelableTypes.find((nonCancelableType) => {
      return nonCancelableType === type
    })
  }

  /**
   * @summary Get the current action
   * @returns {UpdateAction} the current action
   */
  get currentAction() {
    return this._currentAction
  }

  /**
   * @summary Check if the Update is running
   * @returns {Boolean} True if the Update is running
   */
  get isRunning() {
    return this._isRunning
  }

  /**
   * @summary Check if the Update is pausing
   * @returns {Boolean} True if the Update is pausing
   */
  get isPausing() {
    return this._isPausing
  }

  /**
   * @summary Check if the Update is paused
   * @returns {Boolean} True if the Update is paused
   */
  get isPaused() {
    return this._isPaused
  }

  /**
   * @summary Check if the Update is paused by the user
   * @returns {Boolean} True if the Update is paused by the user
   */
  get isPausedByUser() {
    return this._isPausedByUser
  }

  /**
   * @summary Check if the Update is resuming
   * @returns {Boolean} True if the Update is resuming
   */
  get isResuming() {
    return this._isResuming
  }

  /**
   * @summary Starts the Update
   * @returns {undefined} void
   */
  start() {
    if (this.isRunning) {
      this._logger.debug('update: cannot start, already running')
      return
    }

    if (this._isStopped) {
      throw new Error('update: cannot start, has been stopped')
    }

    this.initQueue()

    this._isRunning = true
    this.createSaveHashesInterval()
    this.launchNextAction()
  }

  /**
   * @summary Returns true if pause is allowed
   * @returns {Boolean} true if pause is allowed
   */
  isPauseAllowed() {
    return this.getPauseForbiddenReason() === null
  }

  /**
   * @summary Returns the reason why pause is forbidden
   * @returns {String} the reason why pause is forbidden
   */
  getPauseForbiddenReason() {
    if (!this.isRunning) {
      return 'not running'
    }

    if (this._isPausing) {
      return 'already pausing'
    }

    if (this.isPaused) {
      return 'already paused'
    }

    return null
  }

  /**
   * @summary Pauses the Update
   * @param {boolean} pausedByUser - indicate if the pause has been launched by the user
   * @returns {Promise} A Promise that is resolved when the update process is paused
   */
  pause(pausedByUser = false) {
    if (!this.isPauseAllowed()) {
      this._logger.debug('update: cannot pause, ' + this.getPauseForbiddenReason())
      return Promise.resolve()
    }

    this._isPausing = true
    return this._currentAction.pause()
      .then(() => {
        this.clearSaveHashesInterval()
        this._isPausing = false
        this._isPausedByUser = pausedByUser
        this._isPaused = true
        this.sendLightObjectByIpc()
      })
      .catch((error) => {
        this._logger.warn('update: cannot pause current action', error)
        this.end(error)
      })
  }

  /**
   * @summary Returns true if resume is allowed
   * @returns {Boolean} true if resume is allowed
   */
  isResumeAllowed() {
    return this.getResumeForbiddenReason() === null
  }

  /**
   * @summary Returns the reason why pause is forbidden
   * @returns {String} the reason why pause is forbidden
   */
  getResumeForbiddenReason() {
    if (!this.isRunning) {
      return 'not running'
    }

    if (this._isResuming) {
      return 'already resuming'
    }

    if (!this.isPaused) {
      return 'not paused'
    }

    return null
  }

  /**
   * @summary Resumes the Update
   * @returns {Promise} A Promise that is resolved when the update process is resumed
   */
  resume() {
    if (!this.isResumeAllowed()) {
      this._logger.debug('update: cannot resume, ' + this.getResumeForbiddenReason())
      return Promise.resolve()
    }

    this._isResuming = true
    return this._currentAction.resume()
      .then(() => {
        this.createSaveHashesInterval()
        this._isResuming = false
        this._isPaused = false
        this._isPausedByUser = false
      })
      .catch((error) => {
        this._logger.warn('update: cannot resume current action', error)
        this.end(error)
      })
  }

  /**
   * @summary Stops the Update
   * @param {Boolean} cancelCurrentAction - indicate if the current action must be canceled (will emit a cancel event)
   * @returns {Promise} A Promise that is resolved when the update process is stopped
   */
  stop(cancelCurrentAction = true) {
    this._logger.debug('update: stop', {
      updateId: this.id,
      gameUid: this.gameUid,
      releaseName: this.releaseName,
      isRunning: this.isRunning,
      isQueued: this._updateQueue.contains(this),
    })

    if (!this.isRunning) {
      cancelCurrentAction = false
    }

    this._isStopping = true
    this.clearSaveHashesInterval()
    const cancelPromise = cancelCurrentAction ? this.cancelCurrentAction() : Promise.resolve()
    this._currentAction = null
    this._isRunning = false

    if (this._updateQueue.contains(this)) {
      this._updateQueue.remove(this)
    }

    this.configuration.removeListener('update', this.configurationCallback)
    cancelPromise
      .then(() => {
        this._isStopping = false
        this.emit('cancel')
      })
    return cancelPromise
  }

  /**
   * @summary Handle the end of the sequencer
   * @param {Error} [error] - the error thrown during the update process
   * @returns {undefined} void
   */
  end(error = null) {
    if (this.isRunning) {
      this.stop(false)
        .catch((error) => {
          /* istanbul ignore next */
          this._logger.error('update: cannot stop', error)
        })
    }
    if (error) {
      this.emit('error', error)
    } else {
      this.emit('completed')
    }
  }

  /**
   * @summary Initialize the action's queue.
   * @returns {undefined} void
   */
  initQueue() {
    this._actionsQueue = []

    this.createInitialActions()
    if (this.type !== UPDATE_TYPES.PRE_INSTALL) {
      this.createDiffActions()
      this.createFragmentDownloadActions()
      this.createFinalActions()
    }
  }

  /**
   * @summary Create and queue the initials actions of the update
   * @returns {void} undefined
   */
  createInitialActions() {
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.GET_REMOTE_HASHES))

    if (this.type === UPDATE_TYPES.REPAIR) {
      this._actionsQueue.push(this.createRepairQueuedAction())
    }

    if (this.type === UPDATE_TYPES.INSTALL || this.type === UPDATE_TYPES.UPDATE) {
      this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.GET_LOCAL_HASHES))
    }

    this._actionsQueue.push(this.createDiffQueuedAction([CONFIGURATION_FRAGMENT]))
    this._actionsQueue.push(this.createDownloadFragmentQueuedAction(CONFIGURATION_FRAGMENT))
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.LOAD_CONFIGURATION))
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.CHECK_CONFIGURATION))
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.WRITE_RELEASE_INFOS))
  }

  /**
   * @summary Create and queue a create diff and a check space action
   * @returns {void} undefined
   */
  createDiffActions() {
    this._actionsQueue.push(this.createDiffQueuedAction(this.fragments))
  }

  /**
   * @summary Create and queue download fragments actions
   * @returns {undefined} void
   */
  createFragmentDownloadActions() {
    this._fragments.forEach((fragment) => {
      this._actionsQueue.push(this.createDirectoriesQueuedAction(fragment))
      this._actionsQueue.push(this.createDownloadFragmentQueuedAction(fragment, true))
    })
  }

  /**
   * @summary Create and queue the final action of the update
   * @returns {void} undefined
   */
  createFinalActions() {
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.DELETE_FILES))
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.CLEAR_EMPTY_DIRECTORIES))
    this._actionsQueue.push(this.createQueuedAction(ACTION_TYPES.SAVE_HASHES))
  }

  /**
   * @summary Launch next action in queue
   * @returns {undefined} void
   */
  launchNextAction() {
    if (this._actionsQueue.length === 0) {
      throw new Error('update: cannot launch next action, queue is empty')
    }

    const queueItem = this._actionsQueue.shift()
    this._currentAction = this.createAction(queueItem.type, queueItem.params)
    const params = this._currentAction.params
    const shouldEmitProgress = !!params && params.shouldEmitProgress
    if (shouldEmitProgress) {
      this.emitProgress()
    }
    const promise = this._currentAction.start()
    promise
      .onProgress((progressValue) => {
        if (shouldEmitProgress) {
          this.processActionProgress(progressValue)
        }
      })
      .then((result) => {
        this.processActionResult(result)
        if (this._actionsQueue.length > 0) {
          this.launchNextAction()
        } else {
          this._isUpdatingFragments = this.type !== UPDATE_TYPES.PRE_INSTALL
          this._isRunning = false
          this.end()
        }
      })
      .catch((error) => {
        if (this._isUpdatingFragments) {
          // if the action has been cancelled because the fragment is not necessary anymore, launch the next action
          if (this._actionsQueue.length > 0) {
            this.launchNextAction()
          }
        } else if (!this._isStopping) {
          // if the action has been canceled because the sequencer is stopping, don't call the end handler
          this.end(error)
        }
      })
  }

  /**
   * @summary Returns an action
   * @param {String} type - type of the action
   * @param {Object} params - params of the action
   * @returns {UpdateAction} the created action
   */
  createAction(type, params) {
    params.remoteHashes = this.remoteHashes
    params.localHashes = this.localHashes
    params.diff = this.diff
    params.downloadedHashes = this.downloadedHashes
    params.downloadedArchives = this.downloadedArchives
    params.deletedFiles = this.deletedFiles
    params.fromScratch = this.fromScratch
    params.isRunning = this.isRunning
    params.updateType = this.type

    return this._actionFactory.get(
      type,
      this.repository,
      this.gameUid,
      this.releaseName,
      this.version,
      this.configuration,
      this.location,
      params
    )
  }

  /**
   * @summary Initialize the download progress object with the fragments size
   * @returns {undefined} void
   */
  initializeDownloadProgress() {
    const updateSize = updateHelper.calculateUpdateSize(this.diff)
    let downloadedSize = this.alreadyDownloadedSize
    let totalSize = this.alreadyDownloadedSize
    updateSize.fragmentsSize.forEach(({name: fragmentName, fragmentSize}) => {
      totalSize += fragmentSize
      const fragmentProgress = this.downloadProgress[fragmentName]
      // as the download progress is called twice (after each diff calculation), don't reset the existing value
      if (!fragmentProgress) {
        this.downloadProgress[fragmentName] = {
          downloadedSize: 0,
          totalSize: fragmentSize,
        }
      } else {
        downloadedSize += fragmentProgress.downloadedSize
      }
    })

    this.overallDownloadProgress = {
      downloadedSize,
      totalSize,
    }
  }

  /**
   * @summary Clear the download progress object
   * @returns {undefined} void
   */
  clearDownloadProgress() {
    this.downloadProgress = {}
  }

  /**
   * @summary process the action progress
   * @param {*} progressValue - the progress value of the action
   * @returns {undefined} void
   */
  processActionProgress(progressValue) {
    const action = this._currentAction

    if (!action) {
      return
    }

    if (action.checkType(ACTION_TYPES.REPAIR)) {
      this.processRepairActionProgress(progressValue)
    } else if (action.checkType(ACTION_TYPES.DOWNLOAD_FRAGMENT)) {
      this.processDownloadFragmentActionProgress(
        action.params.fragment,
        action.downloadedFiles,
        action.params.downloadedArchives,
        progressValue
      )
    }

    this.emitProgress()
  }

  /**
   * @summary process the repair action progress
   * @param {*} progressValue - the progress value of the action
   * @returns {undefined} void
   */
  processRepairActionProgress(progressValue) {
    this.repairProgress = progressValue
  }

  /**
   * @summary process the download fragment action progress
   * @param {String} fragmentName - the fragment's name
   * @param {Object} downloadedFiles - the downloaded files (filePath as key)
   * @param {Object} downloadedArchives - the downloaded archives
   * @param {*} progressValue - the progress value of the action
   * @returns {undefined} void
   */
  processDownloadFragmentActionProgress(fragmentName, downloadedFiles, downloadedArchives, progressValue) {
    this.processDownloadFragmentActionResult(fragmentName, downloadedFiles, downloadedArchives)
    if (this.downloadProgress[fragmentName]) {
      this.downloadProgress[fragmentName].downloadedSize = progressValue.downloadedSize
    }

    this.addDownloadedBytes(progressValue.chunkSize)

    this.overallDownloadProgress.downloadedSize = this.alreadyDownloadedSize
    for (let fragmentName in this.downloadProgress) {
      this.overallDownloadProgress.downloadedSize += this.downloadProgress[fragmentName].downloadedSize
    }
  }

  /**
   * @summary emit progress event
   * @returns {undefined} void
   */
  emitProgress() {
    this.emit('progress', {
      currentAction: this._currentAction ? this._currentAction.type : null,
      repairProgress: this.repairProgress,
      downloadProgress: this.downloadProgress,
      overallDownloadProgress: this.overallDownloadProgress,
    })

    if (!this._lastSend || Date.now() - this._lastSend > SEND_PROGRESS_BY_IPC_IN_MS) {
      this._lastSend = Date.now()
      this.computeDownloadSpeed()
      this.sendLightObjectByIpc()
    }
  }

  /**
   * @summary process the action result
   * @param {*} result - the result of the action
   * @returns {undefined} void
   */
  processActionResult(result) {
    const action = this._currentAction
    if (action.checkType(ACTION_TYPES.GET_REMOTE_HASHES)) {
      this.processGetRemoteHashesResult(result)
    } else if (action.checkType(ACTION_TYPES.REPAIR)) {
      this.processGetLocalHashesResult(result)
    } else if (action.checkType(ACTION_TYPES.GET_LOCAL_HASHES)) {
      this.processGetLocalHashesResult(result)
    } else if (action.checkType(ACTION_TYPES.LOAD_CONFIGURATION)) {
      this.processLoadConfigurationResult()
    } else if (action.checkType(ACTION_TYPES.CREATE_DIFF)) {
      this.processCreateDiffResult(result)
    } else if (action.checkType(ACTION_TYPES.DOWNLOAD_FRAGMENT)) {
      this.processDownloadFragmentActionResult(
        action.params.fragment,
        action.downloadedFiles,
        action.downloadedArchives
      )
    } else if (action.checkType(ACTION_TYPES.DELETE_FILES)) {
      this.processDeleteFilesActionResult(result)
    }
  }

  /**
   * @summary process the get remote hashes action result
   * @param {Object} result - the remote hashes action result
   * @returns {undefined} void
   */
  processGetRemoteHashesResult(result) {
    this.remoteHashes = result
  }

  /**
   * @summary process the get local hashes action result
   * @param {Object} result - the local hashes action result
   * @returns {undefined} void
   */
  processGetLocalHashesResult(result) {
    this.localHashes = result
  }

  /**
   * @summary process the load configuration action result
   * @returns {undefined} void
   */
  processLoadConfigurationResult() {
    this.setFragments(this.configuration.fragments)
  }

  /**
   * @summary process the create diff action result
   * @param {Object} result - the create diff action result
   * @returns {undefined} void
   */
  processCreateDiffResult(result) {
    this.diff = result
    this.initializeDownloadProgress()
  }

  /**
   * @summary process the download fragment action result
   * @param {String} fragmentName - the fragment's name
   * @param {Object} downloadedFiles - the downloaded files (filePath as key)
   * @param {Object} downloadedArchives - the downloaded archives
   * @returns {undefined} void
   */
  processDownloadFragmentActionResult(fragmentName, downloadedFiles, downloadedArchives) {
    if (!this.downloadedHashes[fragmentName]) {
      this.downloadedHashes[fragmentName] = {
        files: {},
      }
    }

    this.downloadedHashes[fragmentName].files = downloadedFiles

    if (downloadedArchives && Object.keys(downloadedArchives).length > 0) {
      this.downloadedArchives = downloadedArchives
    }
  }

  /**
   * @summary process the delete files action result
   * @param {Array} deletedFiles - the deleted files
   * @returns {undefined} void
   */
  processDeleteFilesActionResult(deletedFiles) {
    this.deletedFiles = deletedFiles
  }

  /**
   * @summary Cancel current action
   * @returns {Promise} A promise that resolve when the action is canceled
   */
  cancelCurrentAction() {
    return this._currentAction.cancel()
      .catch((error) => {
        this._logger.debug('update: cannot cancel current action', error)
      })
  }

  /**
   * @summary Create an object that represent an action
   * @param {String} type - type of the action
   * @param {Object} [additionalParams] - addition parameters of the action
   * @return {Object} The action
   */
  createQueuedAction(type, additionalParams = null) {
    const params = additionalParams || {}

    return {
      type,
      params,
    }
  }

  /**
   * @summary Create an object that represent a repair action
   * @return {Object} The action
   */
  createRepairQueuedAction() {
    const fragments = this.fragments.slice()
    fragments.push(CONFIGURATION_FRAGMENT)

    return this.createQueuedAction(
      ACTION_TYPES.REPAIR,
      {
        fragments,
        shouldEmitProgress: true,
      }
    )
  }

  /**
   * @summary Create an object that represent a create diff action
   * @param {Array} fragments - fragments for which the diff must be created.
   *                            The configuration fragment will be added automatically.
   * @return {Object} The action
   */
  createDiffQueuedAction(fragments) {
    const fragmentsWithConfiguration = fragments.slice()
    if (!fragments.includes(CONFIGURATION_FRAGMENT)) {
      fragmentsWithConfiguration.push(CONFIGURATION_FRAGMENT)
    }

    return this.createQueuedAction(
      ACTION_TYPES.CREATE_DIFF,
      {
        fragments: fragmentsWithConfiguration,
      }
    )
  }

  /**
   * @summary Create an object that represent a create directories action
   * @param {String} fragment - fragment to download
   * @return {Object} The action
   */
  createDirectoriesQueuedAction(fragment) {
    return this.createQueuedAction(
      ACTION_TYPES.CREATE_DIRECTORIES,
      {
        fragment,
      }
    )
  }

  /**
   * @summary Create an object that represent a download fragment action
   * @param {String} fragment - fragment to download
   * @param {Boolean} shouldEmitProgress - True if the action onProgress should be notified
   * @return {Object} The action
   */
  createDownloadFragmentQueuedAction(fragment, shouldEmitProgress = false) {
    return this.createQueuedAction(
      ACTION_TYPES.DOWNLOAD_FRAGMENT,
      {
        fragment,
        shouldEmitProgress,
      }
    )
  }

  /**
   * @summary Create the saveHashes interval
   * @return {undefined} void
   */
  createSaveHashesInterval() {
    this.saveHashesInterval = setInterval(() => {
      this.launchSaveHashesAction()
    }, SAVE_HASHES_INTERVAL_IN_MS)
  }

  /**
   * @summary Launch saveHashes action
   * @return {undefined} void
   */
  launchSaveHashesAction() {
    this.createAction(ACTION_TYPES.SAVE_HASHES, {}).start()
      .catch((error) => {
        this._logger.warn('update: cannot save hashes', error)
      })
  }

  /**
   * @summary Clear the saveHashes interval
   * @return {undefined} void
   */
  clearSaveHashesInterval() {
    clearInterval(this.saveHashesInterval)
  }

  /**
   * @summary Function called when configuration is updated
   * @returns {undefined} void
   */
  onConfigurationUpdate() {
    this.setFragments(this.configuration.fragments)
  }

  /**
   * @summary Update the isQueued state and send a light object
   * @param {boolean} value - value
   * @returns {undefined} void
   */
  setIsQueued(value) {
    if (this.isQueued === value) {
      return
    }

    this.isQueued = value
    this.sendLightObjectByIpc()
  }

  /**
   * @summary Send a light object to the renderer process by Ipc
   * @returns {undefined} void
   */
  sendLightObjectByIpc() {
    remoteCommunication.send(remoteCommunication.CHANNELS.RELEASE_UPDATE_UPDATED, this.expose())
  }

  /**
   * @summary Create a light object that can be used by the renderer process.
   * @returns {Object} The light object
   */
  expose() {
    const lightObject = {
      isPaused: this.isPaused,
      isPausedByUser: this.isPausedByUser,
      isQueued: this.isQueued,
      gameUid: this.gameUid,
      releaseName: this.releaseName,
      currentAction: this._currentAction ? this._currentAction.type : null,
      repairProgress: this.repairProgress,
      downloadProgress: this.downloadProgress,
      overallDownloadProgress: this.overallDownloadProgress,
      downloadSpeed: this.downloadSpeed,
    }

    return lightObject
  }
}

module.exports = Update
