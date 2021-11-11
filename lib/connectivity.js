/**
 * Connectivity is in charge of checking whether we can access
 * the internet.
 *
 * @fires connectivity#online - When we switch from offline to online.
 * @fires connectivity#offline - When we switch from online to offline.
 *
 * @module zaap/connectivity
 */
const logger = require('./logger')
const inject = require('instill')
const EventEmitter = require('events')
const url = require('url')
const { ipcMain } = require('electron')

inject(exports, {
  dns: require('dns'),
  createEmitter: function () {
    return new EventEmitter()
  },
  remoteCommunication: require('./remoteCommunication'),
})

/**
 * @param {...*} args - Arguments
 * @returns {undefined} void
 * @private
 */
exports.on = function (...args) {
  if (!this.emitter) {
    this.emitter = this.modules.createEmitter()
  }

  this.emitter.on(...args)
}

/**
 * @summary Remove listener
 * @param {String} event event
 * @param {Function} listener listener
 * @return {undefined} void
 */
exports.removeListener = function (event, listener) {
  if (this.emitter) {
    this.emitter.removeListener(event, listener)
  }
}

/**
 * @param {...*} args - Arguments
 * @returns {undefined} void
 * @private
 */
exports.once = function (...args) {
  if (!this.emitter) {
    this.emitter = this.modules.createEmitter()
  }

  this.emitter.once(...args)
}

/**
* @param {...*} args - Arguments
 * @returns {undefined} void
 * @private
 */
exports.emit = function (...args) {
  if (!this.emitter) {
    return
  }

  this.emitter.emit(...args)
}

/**
 * @property {boolean} isOnline The last connectivity result we received from polling.
 */
exports.isOnline = false

/**
 * @property {number} interval The interval instance created by setInterval.
 */
exports.interval = null

/**
 * @summary Start watching the connectivity.
 *
 * This function is called by default (see the application's `index.js`). You should only need
 * to manually call it if you either want to change the polling time,
 * or if you otherwise call `unwatch` at some point.
 *
 * @param {String} server - The server to check for
 * @param {Number} pollingTime - Time interval at which to check the network connectivity, in milliseconds.
 * @returns {undefined} void
 */
exports.watch = function (server, pollingTime = 1000) {
  const self = this
  const {
    dns,
  } = this.modules

  if (this.interval !== null) {
    this.unwatch()
  }

  this.interval = true

  const {
    hostname,
  } = url.parse(server)

  function watch() {
    dns.resolve(hostname, function (error) {
      const isOnline = !error

      if (!self.interval) {
        return
      }

      const hasChanged = self.isOnline !== isOnline
      self.isOnline = isOnline
      self.interval = setTimeout(watch, pollingTime)

      if (hasChanged) {
        if (isOnline) {
          logger.info('Connectivity: we are now online')
          /**
           * @summary When we switch from offline to online
           *
           * To check the current network connectivity status, please
           * have a look at `connectivity.isOnline`.
           *
           * @event module:zaap/connectivity#online
           */
          self.emit('online')
        } else {
          logger.info('Connectivity: we are now offline')
          /**
           * @summary When we switch from online to offline
           *
           * To check the current network connectivity status, please
           * have a look at `connectivity.isOnline`.
           *
           * @event module:zaap/connectivity#offline
           */
          self.emit('offline')
        }
      }
    })
  }

  watch()
}

/**
 * @summary stop watching the network.
 * @returns {undefined} void
 */
exports.unwatch = function () {
  if (this.interval === null) {
    return
  }

  clearInterval(this.interval)
  this.interval = null
}

/**
 * @summary Sync connectivity state with the renderer process
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    remoteCommunication,
  } = this.modules

  const {
    CONNECTIVITY_UPDATED,
    CONNECTIVITY_GET,
  } = remoteCommunication.CHANNELS

  this.on('online', () => {
    remoteCommunication.send(CONNECTIVITY_UPDATED, true)
  })

  this.on('offline', () => {
    remoteCommunication.send(CONNECTIVITY_UPDATED, false)
  })

  ipcMain.on(CONNECTIVITY_GET, (event) => {
    event.returnValue = this.isOnline
  })
}
