const inject = require('instill')

/* istanbul ignore next */
inject(exports, {
  ipcMain: require('electron').ipcMain,
  remoteCommunication: require('../remoteCommunication'),
  connectivity: require('../connectivity'),
  logger: require('../logger'),
  autoUpdater: require('../autoUpdater'),
})

exports.updates = []
exports.currentUpdate = null
exports.isPaused = false

/**
 * @summary Setup the updateQueue
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    connectivity,
    autoUpdater,
    logger,
  } = this.modules

  autoUpdater.on('downloadStarted', () => {
    logger.info('updateQueue: autoUpdate download started, pausing')
    this.checkPauseState()
  })

  connectivity.on('offline', () => {
    logger.info('updateQueue: we are now offline, pausing')
    this.checkPauseState()
  })
  connectivity.on('online', () => {
    logger.info('updateQueue: we are now online, resuming')
    this.checkPauseState()
  })

  this.checkPauseState()
}

/**
 * @summary Add an Update to the queue, and start it if the queue is not already running and not paused
 * @param {Update} update - update to add
 * @returns {undefined} void
 */
exports.add = function (update) {
  const {
    ipcMain,
    remoteCommunication,
    logger,
  } = this.modules

  logger.debug('updateQueue: add', {
    gameUid: update.gameUid,
    releaseName: update.releaseName,
  })

  if (this.updates.length === 0) {
    this.onUpdateSetQueueIndexCallback = this.onUpdateSetQueueIndex.bind(this)
    ipcMain.on(
      remoteCommunication.CHANNELS.RELEASE_UPDATE_SET_QUEUE_INDEX,
      this.onUpdateSetQueueIndexCallback
    )
  }

  this.updates.push(update)

  if ((!this.currentUpdate || this.currentUpdate.isPausedByUser) && !this.isPaused) {
    this.startFirstUpdateInQueue()
  }
}

/**
 * @summary Remove an Update from the queue
 * @param {Update} update - update to remove
 * @returns {undefined} void
 */
exports.remove = function (update) {
  const {
    ipcMain,
    remoteCommunication,
    logger,
  } = this.modules

  logger.debug('updateQueue: remove', {
    updateId: update.id,
    updateType: update.type.toString(),
    gameUid: update.gameUid,
    releaseName: update.releaseName,
    isCurrentUpdate: update === this.currentUpdate,
    isRunning: update.isRunning,
  })

  if (update === this.currentUpdate && this.currentUpdate.isRunning) {
    throw new Error('updateQueue: cannot remove update which is running')
  }

  const index = this.updates.indexOf(update)
  if (index === -1) {
    throw new Error('updateQueue: cannot remove update, not found')
  }

  this.updates.splice(index, 1)

  if (this.updates.length === 0) {
    ipcMain.removeListener(
      remoteCommunication.CHANNELS.RELEASE_UPDATE_SET_QUEUE_INDEX,
      this.onUpdateSetQueueIndexCallback
    )
    this.onUpdateSetQueueIndexCallback = null
  }

  if (update === this.currentUpdate) {
    this.clearCurrentUpdateCallbacks()
    this.currentUpdate = null

    if (!this.isPaused && this.updates.length > 0) {
      this.startFirstUpdateInQueue()
    }
  }
}

/**
 * @summary Check if the update is in the queue
 * @param {Update} update - the update to look for
 * @returns {boolean} true if the update is in the queue
 */
exports.contains = function (update) {
  const queuedUpdate = this.updates.find((updateInArray) => {
    return update === updateInArray
  })

  return !!queuedUpdate
}

/**
 * @summary Update the index of an Update in the queue
 * @param {Update} update - target update
 * @param {Number} newIndex - new index in the queue
 * @returns {Promise} A promise that resolves when the currentUpdate is paused
 */
exports.setIndex = function (update, newIndex, { pausedByUser = false, resumedByUser = false} = {}) {
  const currentIndex = this.updates.indexOf(update)

  if (currentIndex === -1) {
    throw new Error('updaterQueue: cannot setIndex, update not found')
  }

  if (newIndex < 0 || newIndex >= this.updates.length) {
    throw new Error('updaterQueue: cannot setIndex, invalid newIndex')
  }

  if (currentIndex !== newIndex) {
    this.updates.splice(currentIndex, 1)
    this.updates.splice(newIndex, 0, update)
  }

  let pausePromise
  if (newIndex === 0 || currentIndex === 0) {
    if (this.currentUpdate) {
      pausePromise = this.clearCurrentUpdate(pausedByUser)
    }

    if (!this.isPaused) {
      this.startFirstUpdateInQueue(resumedByUser)
    }
  }

  return pausePromise || Promise.resolve()
}

/**
 * @summary Check if the queue must be pauses or resumed
 * @returns {undefined} void
 */
exports.checkPauseState = function () {
  const {
    connectivity,
    autoUpdater,
  } = this.modules

  if (this.isPaused) {
    if (connectivity.isOnline && !autoUpdater.isDownloading) {
      this.resume()
    }
  } else {
    if (!connectivity.isOnline || autoUpdater.isDownloading) {
      this.pause()
    }
  }
}

/**
 * @summary Pause the queue
 * @returns {undefined} void
 */
exports.pause = function () {
  const {
    logger,
  } = this.modules

  if (this.isPaused) {
    logger.debug('updaterQueue: cannot pause, already paused')
    return
  }

  this.isPaused = true
  if (this.currentUpdate && !this.currentUpdate.isPaused) {
    this.currentUpdate.pause()
  }
}

/**
 * @summary Resume the queue
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @param {boolean} resumedByUser = true if the initial action is a resume by the user
 * @returns {undefined} void
 */
exports.resume = function (gameUid = null, releaseName = null, resumedByUser = false) {
  const {
    logger,
  } = this.modules

  if (!this.isPaused) {
    logger.warn('updaterQueue: cannot resume, not paused')
    return
  }

  this.isPaused = false

  if (!!gameUid && !!releaseName) {
    this.setIndex(this.getUpdate(gameUid, releaseName), 0, { pausedByUser: false, resumedByUser })
      .catch((error) => {
        logger.error('updateQueue, cannot set index', error)
      })
  }

  if (this.currentUpdate) {
    if (!this.currentUpdate.isPausedByUser) {
      this.currentUpdate.resume()
    }
  } else if (this.updates.length > 0) {
    this.startFirstUpdateInQueue(resumedByUser)
  }
}

/**
 * @summary Start the first update in queue
 * @param {boolean} resumedByUser = true if the initial action is a resume by the user
 * @returns {undefined} void
 */
exports.startFirstUpdateInQueue = function (resumedByUser = false) {
  const {
    logger,
  } = this.modules

  const update = this.updates[0]

  if (!resumedByUser && update.isPausedByUser) {
    // if the update is paused by user, don't resume and find the next update that can be started
    const nextUpdate = this.updates.find((update) => { return !update.isPausedByUser && !update.isPausing })
    if (nextUpdate) {
      this.setIndex(nextUpdate, 0)
        .catch((error) => {
          logger.error('updateQueue, cannot set index', error)
        })
    }
  } else {
    this.currentUpdate = update
    this.currentUpdate.setIsQueued(false)
    this.updateCompleteCallback = this.onUpdateCompleted.bind(this)
    this.currentUpdate.on('completed', this.updateCompleteCallback)

    if (this.currentUpdate.isRunning && this.currentUpdate.isPaused) {
      this.currentUpdate.resume()
    } else {
      this.currentUpdate.start()
    }
  }
}

/**
 * @summary Start the queue if not paused & not already started
 * @returns {undefined} void
 */
exports.startIfPossible = function () {
  if (!this.isPaused && !this.currentUpdate) {
    this.startFirstUpdateInQueue()
  }
}

/**
 * @summary Resume an update in the queue (action triggered by the user)
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @param {boolean} resumedByUser - true if triggered by the user
 * @returns {undefined} void
 */
exports.resumeUpdate = function (gameUid = false, releaseName = false, resumedByUser = true) {
  const {
    logger,
  } = this.modules

  const update = this.getUpdate(gameUid, releaseName)
  this.setIndex(update, 0, { resumedByUser })
    .catch((error) => {
      logger.error('updateQueue, cannot set index', error)
    })
}

/**
 * @summary Pause the current update (action triggered by the user)
 * @param {boolean} pausedByUser - true if action triggered by the user
 * @returns {Promise} A promise that resolves when the currentUpdate is paused
 */
exports.pauseCurrentUpdate = function (pausedByUser = true) {
  const {
    logger,
  } = this.modules

  if (this.updates.length > 1) {
    return this.setIndex(this.currentUpdate, this.updates.length - 1, { pausedByUser })
      .catch((error) => {
        logger.error('updateQueue, cannot set index', error)
      })
  } else {
    return this.clearCurrentUpdate(true)
  }
}

/**
 * @summary Queue and pause the current update if needed, and clear the current update variable.
 * @param {boolean} pausedByUser = true if the initial action is a pause by the user
 * @returns {Promise} A promise that resolves when the currentUpdate is paused
 */
exports.clearCurrentUpdate = function (pausedByUser = false) {
  if (!this.currentUpdate) {
    throw new Error('updaterQueue: no current update')
  }

  this.clearCurrentUpdateCallbacks()
  this.currentUpdate.setIsQueued(true)
  let pausePromise
  if (!this.currentUpdate.isPaused) {
    pausePromise = this.currentUpdate.pause(pausedByUser)
  }
  this.currentUpdate = null

  return pausePromise || Promise.resolve()
}

/**
 * @summary Clear callbacks on the current update
 * @returns {undefined} void
 */
exports.clearCurrentUpdateCallbacks = function () {
  this.currentUpdate.removeListener('completed', this.updateCompleteCallback)
}

/**
 * @summary Update complete callback
 * @returns {undefined} void
 */
exports.onUpdateCompleted = function () {
  this.clearCurrentUpdateCallbacks()

  // currentUpdate needs to be set to null as remove cancels the update if it's the current update
  const update = this.currentUpdate
  this.currentUpdate = null
  this.remove(update)

  if (this.updates.length > 0) {
    this.startFirstUpdateInQueue()
  }
}

/**
 * @summary ipcMain callback to update queue index
 * @param {string} event - event
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @param {number} index - index
 * @returns {undefined} void
 */
exports.onUpdateSetQueueIndex = function (event, gameUid, releaseName, index) {
  const {
    logger,
  } = this.modules

  this.setIndex(this.getUpdate(gameUid, releaseName), index, { resumedByUser: true })
    .catch((error) => {
      logger.error('updateQueue, cannot set index', error)
    })
}

/**
 * @summary find and return an update in the queue
 * @param {string} gameUid - gameUid
 * @param {string} releaseName - releaseName
 * @returns {Update} Update instance
 */
exports.getUpdate = function (gameUid, releaseName) {
  return this.updates.find((update) => update.gameUid === gameUid && update.releaseName === releaseName)
}
