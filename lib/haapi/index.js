const fs = require('fs')
const path = require('path')
const querystring = require('querystring')
const inject = require('instill')

inject(exports, {
  buildConfig: require('../buildConfig'),
  http: require('../http'),
  getAuth: () => require('../auth'), // Avoid circular dependency
  logger: require('../logger'),
  promiseRetry: require('promise-retry'),
  timeOutMaxRetries: 2,
  timeOutMinInterval: 1000,
  timeOutMaxInterval: 2000,
})

// Errors
const {
  errors,
  ZaapError,
} = require('../errors').register('HAAPI', {
  // General
  API_NOT_FOUND: 6000,
  BAD_CREDENTIALS: 6001,
})

exports.errors = errors

const {
  BAD_CREDENTIALS,
} = errors

const HAAPI_AUTH_ERRORS = {
  BAN: 'haapi.error.ban',
  BLACKLIST: 'haapi.error.blacklist',
  LOCKED: 'haapi.error.locked',
  DELETED: 'haapi.error.deleted',
  RESETANKAMA: 'haapi.error.resetAnkama',
  OTPTIMEFAILED: 'haapi.error.otpTimeFailed',
  SECURITYCARD: 'haapi.error.securityCard',
  BRUTEFORCE: 'haapi.error.bruteForce',
  FAILED: 'haapi.error.failed',
  PARTNER: 'haapi.error.partner',
  MAILNOVALID: 'haapi.error.invalidEmail',
  BETACLOSED: 'haapi.error.closedBeta',
  NOACCOUNT: 'haapi.error.notFound',
  ACCOUNT_LINKED: 'haapi.error.linkedAccount',
  ACCOUNT_INVALID: 'haapi.error.invalidAccount',
  ACCOUNT_SHIELDED: 'haapi.error.shieldedAccount',
}

/**
 * @summary Retrieves an Haapi URL by key
 * @param {string} key Haapi URL key
 * @param {object} queryParameters URL Query parameters
 * @returns {string} The Haapi URL
 */
exports.getUrl = function (key, queryParameters) {
  const {
    buildConfig,
  } = this.modules
  const HAAPI_BASE_URL = buildConfig.haapi.url

  const urls = {
    ANKAMA_ACCOUNT_ACCOUNT: 'Account/Account',
    ANKAMA_ACCOUNT_AVATAR: 'Account/Avatar',
    ANKAMA_ACCOUNT_CREATE_TOKEN: 'Account/CreateToken',
    ANKAMA_ACCOUNT_ORIGIN_WITH_API_KEY: 'Account/OriginWithApiKey',
    ANKAMA_ACCOUNT_STATUS: 'Account/Status',
    ANKAMA_ACCOUNT_SIGN_ON_WITH_API_KEY: 'Account/SignOnWithApiKey',
    ANKAMA_ACCOUNT_SEND_DEVICE_INFOS: 'Account/SendDeviceInfos',
    ANKAMA_ACCOUNT_SET_NICKNAME_WITH_API_KEY: 'Account/SetNicknameWithApiKey',
    ANKAMA_API_CREATE_API_KEY: 'Api/CreateApiKey',
    ANKAMA_API_DELETE_API_KEY: 'Api/DeleteApiKey',
    ANKAMA_API_REFRESH_API_KEY: 'Api/RefreshApiKey',
    ANKAMA_LEGALS_TOU: 'Legals/Tou',
    ANKAMA_LEGALS_SET_TOU_VERSION: 'Legals/SetTouVersion',
    ANKAMA_CMS_ITEMS_GET: 'Cms/Items/Get',
    ANKAMA_GAME_START_SESSION_WITH_API_KEY: 'Game/StartSessionWithApiKey',
    ANKAMA_GAME_END_SESSION_WITH_API_KEY: 'Game/EndSessionWithApiKey',
    ANKAMA_GAME_SEND_EVENTS: 'Game/SendEvents',
  }

  let url = HAAPI_BASE_URL + urls[key]

  const stringifiedQueryParameters = querystring.stringify(queryParameters)
  if (stringifiedQueryParameters) {
    url += '?' + stringifiedQueryParameters
  }

  return url
}

// Available HAAPI API calls - each call is prefixed
// by a reference to the HAAPI module so to make dependency
// injection work properly during unit testing
const HAAPI_APIS = {}

const apisDir = path.join(__dirname, 'apis')
fs.readdirSync(apisDir).forEach(function (api) {
  const name = api.substring(api, api.length - 3)
  const filePath = path.join(apisDir, api)
  HAAPI_APIS[name] = require(filePath)
})

/**
 * @summary Call a remote HAAPI API
 * @param {string} name The name of the API (example: 'ankama.legal.terms')
 * @param {...*} args Arguments to pass to the call
 * @returns {Promise} Promise object
 */
exports.get = function (name, ...args) {
  const {
    getAuth,
    logger,
    promiseRetry,
    timeOutMaxRetries,
    timeOutMinInterval,
    timeOutMaxInterval,
  } = this.modules

  const {
    API_NOT_FOUND,
  } = errors

  const auth = getAuth()
  const call = HAAPI_APIS[name]

  const doGet = (retry, number) => {
    return new Promise((resolve) => {
      if (!call) {
        throw new ZaapError(API_NOT_FOUND, `Requested API call does not exist (${name})`)
      }

      const promise = call(this, ...args)

      resolve(promise.catch((error) => {
        if (error.statusCode === 601) {
		  console.log(error.statusCode + ":" + JSON.parse(error.body).reason);
          logger.error('Haapi:', BAD_CREDENTIALS, HAAPI_AUTH_ERRORS[JSON.parse(error.body).reason])
          throw new ZaapError(BAD_CREDENTIALS, HAAPI_AUTH_ERRORS[JSON.parse(error.body).reason])
        }

        if (error.statusCode === 603) {
          logger.error('Logout because of status code 603 from Haapi')
          auth.logout()
        }

        if (error.type === 'request-timeout' && number <= timeOutMaxRetries) {
          logger.warn('haapi timeout (' + name + '), retry (' + number + ')')
          retry(error)
        } else {
          logger.error('haapi error', error)
          throw error
        }
      }))
    })
  }

  const options = {
    retries: timeOutMaxRetries,
    minTimeout: timeOutMinInterval,
    maxTimeout: timeOutMaxInterval,
  }

  return promiseRetry(doGet, options)
}
