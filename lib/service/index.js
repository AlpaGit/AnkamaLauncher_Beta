/**
 * Services exposed to games managed by Zaap.
 *
 * @module zaap/services
 */

// Require Thrift-generated code
const protocolGeneratedNode = require('protocol-generated-nodejs')
const TYPES = protocolGeneratedNode.service_types
const ZaapService = protocolGeneratedNode.ZaapService

// Imports
const parseFunction = require('parse-function')().parse
const inject = require('instill')
const logger = require('../logger')

// Find methods attached to the client prototype (class)
const clientMethods = Object.keys(ZaapService.Client.prototype)

/* istanbul ignore next */
inject(exports, {
  buildConfig: require('../buildConfig'),
  development: require('./development'),
  fs: require('fs'),
  require: require,
  thrift: require('thrift'),
  uuid: require('uuid'),
  // Extract only the calls that RPC calls;
  // the client defines a whole bunch of additional methods,
  // but only the ones that also are accompanied by a related
  // recv_ and send_ calls matter to us.
  thriftDefinedApis: clientMethods.filter(function (key) {
    return clientMethods.includes(`send_${key}`) && clientMethods.includes(`recv_${key}`)
  }),
})

/**
 * This wrapping is used mostly so that we may log the input
 * and output of the calls made to service endpoints.
 *
 * @summary Wrap each calls for logging and tracing
 * @param {string} name The name of the method to wrap
 * @param {Function} func The function body
 * @returns {Function} The resulting wrapped function
 * @private
 */
const wrapRPCFunction = function (name, func) {
  return function (...args) {
    const callback = args.pop()
    logger.debug(`service: request ${name}`, args)

    args.push(function (...args) {
      logger.debug(`service: reply ${name}`, args)
      callback(...args)
    })

    func.apply(func, args)
  }
}

/**
 * @property Types imported from Thrift's generated code
 */
exports.TYPES = TYPES

/**
 * @property The server instance
 */
exports.server = null

/**
 * @summary Retrieve the port on which the service listens
 * @returns {number} Port number
 */
exports.getLocalPort = function () {
  const {
    buildConfig,
  } = this.modules

  if (buildConfig.service && buildConfig.service.port) {
    return buildConfig.service.port
  }

  return 26116
}

/**
 * @summary Start the service
 * @param {Function} [callback=null] - Callback function
 * @returns {undefined} void
 */
exports.start = function (callback) {
  const {
    development,
    thrift,
    thriftDefinedApis,
    require,
  } = this.modules

  if (this.server) {
    throw new Error('Server already started!')
  }

  // This object will contain the function calls
  // for the RPC calls that are defined in the Thrift
  // file
  const rpcs = {}

  // We want to make sure that the RPC functions defined
  // under ./rpcs exist, and that they provide a proper function
  thriftDefinedApis.forEach(function (rpc) {
    logger.debug(`service: loading function for RPC call ${rpc}`)
    try {
      // Add the function to the list of RPC call handlers
      const func = require(`./rpcs/${rpc}`)

      // Make sure we indeed received a function
      if (typeof func !== 'function') {
        throw new Error('module.exports does not expose a function')
      }

      // Finally, we want to make sure that the function signature
      // will be exactly the same as defined in the .thrift definition
      // file; we want to make sure that parameters are named the same, and
      // that all parameters are indeed present.
      const thriftDefinedFuncSignature = parseFunction(ZaapService.Client.prototype[rpc]).params
      const funcSignature = func.params || parseFunction(func).params

      if (thriftDefinedFuncSignature !== funcSignature) {
        const expected = `(${thriftDefinedFuncSignature})`
        const received = `(${funcSignature})`
        throw new Error(`Loaded RPC function signature incorrect, should be ${expected}, got ${received}`)
      }

      // If no errors were found, add the function as a handler for
      // the given RPC call
      rpcs[rpc] = wrapRPCFunction(rpc, func)
    } catch (error) {
      error.message = `Failed to load or find RPC definition for ${rpc}: ${error.message}`
      throw error
    }
  })

  // We create the server, and listen on a named pipe
  const port = this.getLocalPort()

  logger.debug(`service: starting Thrift server on port ${port}`)

  this.server = thrift.createServer(ZaapService, rpcs)

  this.server.on('error', this.onServerError)

  this.server.listen(port, 'localhost', (error) => {
    logger.info(`service: started server on port ${port}`)
    development.watch(this)
    callback(error)
  })
}

/**
 * @summary Callback for server error
 * @param {Object} error
 * @returns {undefined} void
 */
/* istanbul ignore next */
exports.onServerError = function (error) {
  console.error('server error', error)
}

/**
 * @summary Stop the service
 * @returns {undefined} void
 */
exports.stop = function () {
  const {
    development,
  } = this.modules

  if (!this.isServerRunning()) {
    throw new Error('Server was not started')
  }

  development.unwatch()
  this.server.close()
  logger.info(`service: stopped server`)
  this.server = null
}

/**
 * @summary Check whether the service API server is running
 * @returns {boolean} True if the server is currently running
 */
exports.isServerRunning = function () {
  return !!this.server
}

/**
 * @summary Check whether any games are currently connected
 * @returns {boolean} True if at least one game is currently connected
 */
exports.hasConnectedProcesses = function () {
  return this.isServerRunning() && this.server._connections !== 0
}

let instanceCounter = 0

/**
 * Credentials used to authenticate a running game instance to
 * Zaap's service API
 */
exports.credentials = {}

/**
 * Connected releases, by API key
 */
exports.releases = {}

/**
 * @summary compute a credential key using the game process id and channel
 * @param {string} gameUid game uid
 * @param {string} release release name
 * @param {number} releaseProcessId Release process ID
 * @returns {string} The computed key
 */
function getCredentialsKey(gameUid, release, releaseProcessId) {
  return [gameUid, release, releaseProcessId.toString()].join('/')
}

/**
 * This information will be used by the release at game
 * process start and stop; the release is expected to be
 * calling this method whenever it is about to start a
 * process instance, and it is expected to
 *
 * @summary Generate env. variables a unique ID for the release
 * @param {Release} release The release for which we are about to start a process instance
 * @returns {Object} info { id, env }
 */
exports.createEnvironmentForRelease = function (release) {
  const {
    uuid,
  } = this.modules

  instanceCounter += 1

  const id = instanceCounter
  const hash = uuid()

  this.registerCredentials(release, id, hash)

  return {
    id,
    env: {
      ZAAP_PORT: this.getLocalPort(),
      ZAAP_GAME: release.gameUid,
      ZAAP_RELEASE: release.name,
      ZAAP_INSTANCE_ID: id,
      ZAAP_HASH: hash,
      ZAAP_CAN_AUTH: release.getRunningInstancesCount() === 0,
      ZAAP_LOGS_PATH: release.getLogsPath(),
    },
  }
}

/**
 * @summary Create a credential hash and register it for a game release to use
 * @param {Release} release The release for which to create credentials for
 * @param {number} releaseProcessId Release process ID
 * @param {string} hash Private hash used that will be used as an identification token
 * @returns {string} The authentication hash the game must used upon connection
 */
exports.registerCredentials = function (release, releaseProcessId, hash) {
  const key = getCredentialsKey(release.gameUid, release.name, releaseProcessId)
  this.credentials[key] = {
    id: releaseProcessId,
    hash,
    release,
  }
}

/**
 * @summary Invalidate the authentication information for a given game release
 * @param {Release} release The release for which to invalidate credentials for
 * @param {number} releaseProcessId Release process ID
 * @returns {undefined} void
 */
exports.invalidateCredentials = function (release, releaseProcessId) {
  const key = getCredentialsKey(release.gameUid, release.name, releaseProcessId)

  // Remove any key the process might have previously created
  this.removeKeyForReleaseProcessId(releaseProcessId)

  delete this.credentials[key]
}

/**
 * @summary Validate the received credentials
 * @param {string} gameUid game uid
 * @param {string} releaseName release name of a given game
 * @param {number} releaseId internal release identifier
 * @param {string} hash the authentication hash as created by `createCredentials`
 * @returns {boolean} true if valid, false otherwise
 */
exports.validateCredentials = function (gameUid, releaseName, releaseId, hash) {
  const key = getCredentialsKey(gameUid, releaseName, releaseId)
  const info = this.credentials[key]

  if (info && info.hash === hash) {
    return info.release
  }

  return false
}

/**
 * @summary Create a temporary API key for a connected game release instance
 * @param {Release} release Game release instance
 * @param {number} releaseProcessId Release process ID
 * @returns {string} API key
 */
exports.createKeyForReleaseProcessId = function (release, releaseProcessId) {
  const {
    uuid,
  } = this.modules

  // Invalidate any previous key we might have registered
  this.removeKeyForReleaseProcessId(releaseProcessId)

  const key = uuid()
  this.releases[key] = {
    id: releaseProcessId,
    release,
  }

  return key
}

/**
 * @summary Forget all known API keys for a given game release
 * @param {number} releaseProcessId Release process ID
 * @returns {undefined} void
 */
exports.removeKeyForReleaseProcessId = function (releaseProcessId) {
  const keys = Object.keys(this.releases)

  for (const key of keys) {
    if (this.releases[key].id === releaseProcessId) {
      delete this.releases[key]
    }
  }
}

/**
 * @summary Retieve a game release by API key
 * @param {string} key API key
 * @returns {release.Release | undefined} Retrieve the release
 */
exports.getReleaseByKey = function (key) {
  const releaseInfo = this.releases[key]
  return releaseInfo ? releaseInfo.release : undefined
}

/**
 * @summary Retieve a game instance id by API key
 * @param {string} key API key
 * @returns {release.id | undefined} Retrieve the id
 */
exports.getInstanceIdByKey = function (key) {
  const releaseInfo = this.releases[key]
  return releaseInfo ? releaseInfo.id : undefined
}

/**
 * @summary Validate a session key, and return the related release (or throw a ZaapError)
 * @param {string} sessionKey  Session key to validate
 * @returns {release.Release} Release for this session key
 * @throws {ZaapProtocolError} Authentication error to return to the client
 */
exports.authorize = function (sessionKey) {
  const {
    ZaapError: ZaapProtocolError,
    ErrorCode,
  } = this.TYPES

  const {
    UNAUTHORIZED,
    INVALID_GAME_SESSION,
  } = ErrorCode

  if (!sessionKey) {
    throw new ZaapProtocolError({code: INVALID_GAME_SESSION})
  }

  const release = this.getReleaseByKey(sessionKey)

  if (!release) {
    throw new ZaapProtocolError({code: UNAUTHORIZED})
  }

  return release
}

/**
 * @summary RPC method factory for authenticated service calls
 * @param {Function} methodCall The actual method code
 * @returns {Function} Wrapped method call
 */
exports.createAuthorizedMethod = function (methodCall) {
  const wrapped = (sessionKey, ...args) => {
    const callback = args[args.length - 1]

    try {
      // We use wrapped as the this context so that if anyting else
      // is injected on it, we will be able to use it from
      // within that function's context
      methodCall.call(wrapped, this.authorize(sessionKey), ...args)
    } catch (error) {
      return callback(error)
    }
  }

  const args = parseFunction(methodCall).args
  args[0] = 'gameSession'
  wrapped.params = args.join(', ')

  return wrapped
}
