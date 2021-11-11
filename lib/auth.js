/**
 * This module manage user authentication
 *
 * @module zaap/auth
 */
const inject = require('instill')
const EventEmitter = require('events')
const path = require('path')
const util = require('util')

const Auth = function () {
}
util.inherits(Auth, EventEmitter)
module.exports = exports = new Auth()

/* istanbul ignore next */
inject(exports, {
  cryptoHelper: require('./cryptoHelper'),
  settings: require('./settings'),
  buildConfig: require('./buildConfig'),
  haapi: require('./haapi'),
  avatar: require('./avatar'),
  logger: require('./logger'),
  remoteCommunication: require('./remoteCommunication'),
  app: require('./app'),
  ipcMain: require('electron').ipcMain,
  kpi: require('./kpi'),
  user: require('./user'),
  fs: require('fs'),
})

// Errors
const {
  errors,
  ZaapError,
} = require('./errors').register('AUTH', {
  APIKEY_NOT_FOUND: 7000,
  UNABLE_TO_STORE_APIKEY: 7001,
  UNABLE_TO_RETRIEVE_APIKEY: 7002,
})

exports.errors = errors

exports.apiKey = null

const API_KEY_FILENAME = '.keydata'

/**
 * @summary Start the ipc communication between the main and renderer process
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    remoteCommunication,
    settings,
    app,
    ipcMain,
    logger,
    kpi,
  } = this.modules

  // logout if the userInfo become undefined (it happens if the user deletes his settings files)
  settings.watch(settings.KEYS.USER_INFO, (newValue) => {
    if (!newValue && this.isAuthenticated()) {
      logger.warn('auth: undefined userInfo, logout user')
      this.logout()
        .catch((error) => {
          logger.error('auth: unable to logout', error)
        })
    }
  })

  app.on('will-quit', (event) => {
    const {
      settings,
      app,
      kpi,
    } = this.modules

    if (kpi.isStarted()) {
      event.preventDefault()
      kpi.end()
        .then(() => {
          app.quit()
        })
    } else if (this.isAuthenticated() && !settings.get(settings.KEYS.STAY_LOGGED_IN)) {
      event.preventDefault()
      this.deleteApiKey()
        .then(() => {
          app.quit()
        })
        .catch(() => {
          // set apikey to null (if not, this event will be called infinitely),
          this.apiKey = null
          app.quit()
        })
    }
  })

  ipcMain.on(remoteCommunication.CHANNELS.AUTH_GET, (event) => {
    event.returnValue = this.expose()
  })

  ipcMain.on(remoteCommunication.CHANNELS.AUTH_LOGIN, (event, login, password, stayLoggedIn) => {
    this.login(login, password, stayLoggedIn)
      .catch((error) => {
        logger.error('auth: login error', error)
        event.sender.send(remoteCommunication.CHANNELS.AUTH_LOGIN_ERROR, error)
      })
  })

  ipcMain.on(remoteCommunication.CHANNELS.AUTH_LOGOUT, () => {
    kpi.end()
    // wait for all kpi sent with apiKey before logout
    process.nextTick(() => {
      this.logout()
        .catch((error) => {
          logger.error('auth: unable to logout', error)
        })
    })
  })
}

/**
 * @summary Return the path to the file where the api key is stored
 * @returns {string} the path to the file where the api key is stored
 */
exports.getApiKeyFilepath = function () {
  const {
    app,
  } = this.modules

  return path.join(app.getPath('userData'), API_KEY_FILENAME)
}

/**
 * @summary Create a light object that can be used by the renderer process.
 * @returns {Object} The light object
 */
exports.expose = function () {
  return {
    isAuthenticated: this.isAuthenticated(),
  }
}

/**
 * @summary Send a light object to the renderer process by Ipc
 * @returns {undefined} void
 */
exports.sendLightObjectByIpc = function () {
  const {
    remoteCommunication,
  } = this.modules

  remoteCommunication.send(remoteCommunication.CHANNELS.AUTH_UPDATED, this.expose())
}

/**
 * @summary Authenticate an user by login and password to retrieve an API key
 * @param {string} login User login
 * @param {string} password User password
 * @param {boolean} stayLoggedIn Keep apiKey for the next launch
 * @returns {Promise} User is logged or bad credentials
 */
exports.login = function (login, password, stayLoggedIn) {
  const {
    haapi,
    logger,
    settings,
    user,
    remoteCommunication,
  } = this.modules

  const {
    LAST_AUTHENTICATED_ACCOUNT_ID,
    LAST_AUTHENTICATED_LOGIN,
    STAY_LOGGED_IN,
  } = settings.KEYS

  return haapi.get('ankama.api.createApiKey', login, password)
    .then((apiKey) => {
      this.apiKey = apiKey
      this.sendLightObjectByIpc()

      settings.set(LAST_AUTHENTICATED_LOGIN, login)
      settings.set(STAY_LOGGED_IN, stayLoggedIn)

      user.setOrigin()
        .then(() => {
          remoteCommunication.send(remoteCommunication.CHANNELS.USER_RELEASE_READY)
        })
        .catch((error) => {
          /* istanbul ignore next */
          logger.error('auth: unable to update set origin', error)
        })

      user.updateStatus()
        .catch((error) => {
          logger.error('auth: unable to update user status', error)
        })

      this.emit('logged-in')
      this.signOnWithApiKey()
        .catch((error) => {
          logger.error('auth: unable to sign on with api key', error)
        })

      if (stayLoggedIn) {
        settings.set(LAST_AUTHENTICATED_ACCOUNT_ID, apiKey.accountId)
        return this.storeApiKey()
      }
    })
}

/**
 * @summary Logout logged user
 * @returns {Promise} when user is logged out
 */
exports.logout = function () {
  const {
    fs,
    logger,
    settings,
  } = this.modules

  const {
    USER_INFO,
    LAST_AUTHENTICATED_ACCOUNT_ID,
  } = settings.KEYS

  const postDeleteApiKey = () => {
    const filepath = this.getApiKeyFilepath()
    fs.unlink(filepath, (error) => {
      if (error) {
        logger.warn('auth: cannot delete api key file', error)
      }
    })
    this.apiKey = null
    this.sendLightObjectByIpc()
    settings.delete(LAST_AUTHENTICATED_ACCOUNT_ID)
    settings.delete(USER_INFO)
  }

  const deleteApiKeyPromise = this.deleteApiKey()

  return deleteApiKeyPromise
    .then(postDeleteApiKey)
    .catch(postDeleteApiKey)
}

/**
 * @summary Store an API key into the OS password manager
 * @returns {undefined} void
 */
exports.storeApiKey = function () {
  const {
    cryptoHelper,
  } = this.modules

  const {
    UNABLE_TO_STORE_APIKEY,
  } = errors

  const filepath = this.getApiKeyFilepath()
  return cryptoHelper.encryptToFileWithUUID(filepath, this.apiKey)
    .catch((error) => {
      throw new ZaapError(UNABLE_TO_STORE_APIKEY, `Unable to store API key : ${error.message}`)
    })
}

/**
 * @summary Sign on with api key, start KPI and update user info
 * @returns {Promise} When user is signed on
 */
exports.signOnWithApiKey = function () {
  const {
    kpi,
    logger,
    user,
  } = this.modules

  return kpi.signOn()
    .then(({account}) => {
      user.setInfo(account)
    })
    .catch((error) => {
      logger.error('auth: cannot sign on with api key', error)
    })
}

/**
 * @summary Authenticate user with stored API key from the OS password manager
 * @returns {Promise} User is authenticated or nothing happens
 */
exports.authenticateFromStoredApiKey = function () {
  const {
    settings,
    cryptoHelper,
    kpi,
    logger,
    user,
  } = this.modules

  const {
    LAST_AUTHENTICATED_ACCOUNT_ID,
  } = settings.KEYS

  const accountId = settings.get(LAST_AUTHENTICATED_ACCOUNT_ID)

  if (!accountId) {
    return new Promise((resolve) => resolve())
  }

  const filepath = this.getApiKeyFilepath()

  // Always resolve as this feature is non-blocking
  return new Promise((resolve) => {
    const decryptPromise = cryptoHelper.decryptFromFileWithUUID(filepath)
    // Catch decrypt specific errors first
    decryptPromise
      .catch((error) => {
        logger.warn(`auth: Unable to retrieve API key: ${error.message}`)
        resolve()
      })

    // Manage the decrypted apikey
    decryptPromise
      .then((apiKey) => {
        this.apiKey = apiKey
        this.sendLightObjectByIpc()

        user.updateStatus()
          .catch((error) => {
            logger.error('auth: unable to update user status', error)
          })

        this.emit('logged-in')

        return kpi.signOn()
      })
      .then(() => this.refreshApiKey())
      .then(resolve)
      .catch((error) => {
        logger.warn(`auth: Unable to authenticateFromStoredApiKey: ${error.message}`)
        resolve()
      })
  })
}

/**
 * @summary Refresh the api key
 * @returns {Promise} When api key is refreshed
 */
exports.refreshApiKey = function () {
  const {
    haapi,
    logger,
  } = this.modules

  return haapi.get('ankama.api.refreshApiKey')
    .then(({refreshToken}) => {
      this.apiKey.refreshToken = refreshToken
      return this.storeApiKey()
    })
    .catch((error) => {
      logger.error('auth: unable to refresh api key', error)
    })
}

/**
 * @summary delete the api key
 * @returns {Promise} void
 */
exports.deleteApiKey = function () {
  const {
    haapi,
    logger,
  } = this.modules

  return haapi.get('ankama.api.deleteApiKey')
    .then(() => {
      this.apiKey = null
      logger.info('auth: api key deleted')
    })
    .catch((error) => {
      /* istanbul ignore next */
      logger.error('auth: unable to delete api key', error)
    })
}

/**
 * @summary Lets know if an user is already authenticated
 * @returns {boolean} True if user is authenticated
 */
exports.isAuthenticated = function () {
  return !!this.apiKey
}

/**
 * @summary Create token
 * @param {Number} gameId The game id
 * @return {Promise} When token is created
 */
exports.createToken = function (gameId) {
  const {
    haapi,
  } = this.modules

  return haapi.get('ankama.account.createToken', gameId)
}
