// When the promise is pending
const STATE_RESUMED = Symbol()
// When the promise is pending and paused
const STATE_PAUSED = Symbol()
// When the promise was resolved
const STATE_FULFILLED = Symbol()
// When a ControllablePromiseCancelError was rejected
const STATE_CANCELED = Symbol()
// When an Error which is not a cancelError was rejected
const STATE_REJECTED = Symbol()

/**
 * @class ControllablePromiseCancelError
 * @extends {Error}
 */
class ControllablePromiseCancelError extends Error {
  /**
   * Creates an instance of ControllablePromiseCancelError.CancelError
   */
  constructor() {
    super('Controllable Promise was canceled')
    this.name = 'ControllablePromiseCancelError'
  }
}

/**
 * @class ControllablePromisePreconditionError
 * @extends {Error}
 */
class ControllablePromisePreconditionError extends Error {
  /**
   * Creates an instance of ControllablePromiseCancelError.CancelError
   * @argument {String} message - The error message
   */
  constructor(message) {
    super(message)
    this.name = 'ControllablePromisePreconditionError'
  }
}

/**
 * @class ControllablePromise
 */
class ControllablePromise {
  /**
   * Creates an instance of ControllablePromise.
   * @param {Function} executor - Executor
   */
  constructor(executor) {
    this.lock = false
    this.state = STATE_RESUMED

    // A controllable promise can have multiple onProgress handlers
    this.listeners = new Set()

    this.resolveMain = () => {}
    this.rejectMain = () => {}

    // These function will be called in case of 'atomic controllable promises'
    this.resolvePause = () => {}
    this.rejectPause = () => {}
    this.resolveCancel = () => {}
    this.rejectCancel = () => {}

    this.promise = new Promise((resolveMain, rejectMain) => {
      this.rejectMain = rejectMain

      const resolve = (value) => {
        // We resolve pause and cancel in case of atomic controllable promise
        this.resolvePause()
        this.resolveCancel()
        // Next event loop
        setTimeout(() => {
          if (this.isCanceled) {
            return rejectMain(new ControllablePromiseCancelError())
          }
          // If a resolve() is requested while in paused state,
          // we defer the fulfillment to the next resume()
          const fulfillMain = () => {
            this.state = STATE_FULFILLED
            resolveMain(value)
          }
          if (!this.isPaused) {
            fulfillMain()
          } else {
            this.resolveMain = fulfillMain
          }
        })
      }

      const reject = (error) => {
        this.rejectPause(error)
        this.rejectCancel(error)
        this.state = STATE_REJECTED
        rejectMain(error)
      }

      const onProgress = (stats) => {
        this.listeners.forEach(listener => listener(stats))
      }

      const pause = (pauseFn) => this.pauseFn = pauseFn
      const resume = (resumeFn) => this.resumeFn = resumeFn
      const cancel = (cancelFn) => this.cancelFn = cancelFn

      return executor(resolve, reject, onProgress, pause, resume, cancel)
    })
  }

  /**
   * @param {function} onFulfilled - callback
   * @returns {Promise} - A classic promise
   */
  then(onFulfilled) {
    return this.promise.then(onFulfilled)
  }

  /**
   * @param {function} onRejected - callback
   * @returns {Promise} - A classic promise
   */
  catch(onRejected) {
    return this.promise.catch(onRejected)
  }

  /**
   * @returns {Promise} - A classic promise
   */
  pause() {
    return new Promise((resolvePause, rejectPause) => {
      if (this.lock) {
        rejectPause(new ControllablePromisePreconditionError('Operation in progress'))
        return
      }

      if (this.isCanceled) {
        rejectPause(new ControllablePromisePreconditionError('Promise was canceled'))
        return
      }

      if (this.isSettled) {
        rejectPause(new ControllablePromisePreconditionError('Promise was settled'))
        return
      }

      if (this.isPaused) {
        resolvePause()
        return
      }

      this.lock = true

      if (typeof this.pauseFn !== 'function') {
        // No callback is provided for onPause
        this.resolvePause = resolvePause
        this.rejectPause = rejectPause
      } else {
        this.pauseFn(resolvePause, rejectPause)
      }
    }).then(() => {
      this.lock = false
      this.state = STATE_PAUSED
    }).catch((error) => {
      if (!(error instanceof ControllablePromisePreconditionError)) {
        this.lock = false
      }

      throw error
    })
  }

  /**
   * @returns {Promise} - A classic promise
   */
  resume() {
    return new Promise((resolveResume, rejectResume) => {
      if (this.lock) {
        rejectResume(new ControllablePromisePreconditionError('Operation in progress'))
        return
      }

      if (this.isCanceled) {
        rejectResume(new ControllablePromisePreconditionError('Promise was canceled'))
        return
      }

      if (this.isSettled) {
        rejectResume(new ControllablePromisePreconditionError('Promise was settled'))
        return
      }

      if (this.isResumed) {
        resolveResume()
        return
      }

      if (typeof this.resumeFn !== 'function') {
        // No callback is provided for onResume
        // We resolve pause promise if main promise is finished
        this.resolvePause()
        resolveResume()

        // We resolve main promise if it is finished
        this.resolveMain()
        return
      }

      this.lock = true
      this.resumeFn(resolveResume, rejectResume)
    }).then(() => {
      this.lock = false
      this.state = STATE_RESUMED
    }).catch((error) => {
      if (!(error instanceof ControllablePromisePreconditionError)) {
        this.lock = false
      }

      throw error
    })
  }

  /**
   * @returns {Promise} - A classic promise
   */
  cancel() {
    return new Promise((resolveCancel, rejectCancel) => {
      if (this.lock) {
        rejectCancel(new ControllablePromisePreconditionError('Operation in progress'))
        return
      }

      if (this.isCanceled) {
        rejectCancel(new ControllablePromisePreconditionError('Promise was canceled'))
        return
      }

      if (this.isSettled) {
        rejectCancel(new ControllablePromisePreconditionError('Promise was settled'))
        return
      }

      this.lock = true

      if (typeof this.cancelFn !== 'function') {
        // No callback is provided for onCancel
        this.resolveCancel = resolveCancel
        this.rejectCancel = rejectCancel
        return
      }

      this.cancelFn(resolveCancel, rejectCancel)
    }).then(() => {
      this.lock = false

      if (typeof this.cancelFn === 'function' && this.isSettled) {
        throw new Error('Promise was settled during cancel handler')
      }

      this.state = STATE_CANCELED
      this.rejectMain(new ControllablePromiseCancelError())
    }).catch((error) => {
      if (!(error instanceof ControllablePromisePreconditionError)) {
        this.lock = false
      }

      throw error
    })
  }

  /**
   * @readonly
   * @returns {boolean} - True is the controllable promise is paused
   */
  get isPaused() {
    return this.state === STATE_PAUSED
  }

  /**
   * @readonly
   * @returns {boolean} - True is the controllable promise is resumed
   */
  get isResumed() {
    return this.state === STATE_RESUMED
  }

  /**
   * @readonly
   * @returns {boolean} - True is the controllable promise is canceled
   */
  get isCanceled() {
    return this.state === STATE_CANCELED
  }

  /**
   * @readonly
   * @returns {boolean} - True is the controllable promise is rejected
   */
  get isRejected() {
    return this.state === STATE_REJECTED
  }

  /**
   * @readonly
   * @returns {boolean} - True is the controllable promise is fulfilled
   */
  get isFulfilled() {
    return this.state === STATE_FULFILLED
  }

  /**
   * @readonly
   * @returns {boolean} - True is the controllable promise is canceled, rejected or fulfilled
   */
  get isSettled() {
    return this.state === STATE_CANCELED || this.state === STATE_REJECTED || this.state === STATE_FULFILLED
  }

  /**
   * @param {Function} cb - callback
   * @returns {ControllablePromise} - The controllable promise itself
   * @throws {TypeError} - Thrown when argument is not a function
   */
  onProgress(cb) {
    if (typeof cb !== 'function') {
      throw new TypeError(`Expected a Function, got ${typeof cb}`)
    }

    this.listeners.add(cb)
    return this
  }
}

module.exports = ControllablePromise
module.exports.ControllablePromiseCancelError = ControllablePromiseCancelError
