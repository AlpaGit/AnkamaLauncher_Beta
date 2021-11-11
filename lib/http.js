/**
 * Abstract HTTP to globally manage
 * all HTTP-related difficulties
 *
 * @module zaap/http
 */
const inject = require('instill')
const JSONbig = require('json-bigint')
const querystring = require('querystring')

inject(exports, {
  electronFetch: require('electron-fetch'),
  app: require('./app'),
  buildConfig: require('./buildConfig'),
})

const HttpError = function (response, body) {
  Error.captureStackTrace(this, this.constructor)

  this.statusCode = response.status
  this.message = 'Http request failed'
  this.body = body
}
exports.HttpError = HttpError

/**
 * @summary Make an HTTP call with defaults
 * @param {String} url url
 * @param {Object} options electronFetch options
 * @returns {Promise} Promise object
 */
exports.request = function (url, options) {
  const {
    electronFetch,
    app,
    buildConfig,
  } = this.modules

  options = Object.assign({
    timeout: 5000,
    useElectronNet: !buildConfig.allowInsecureHttps,
  }, options)

  Object.assign(options.headers, {
    'User-Agent': 'Zaap ' + app.getVersion(),
  })

  return new Promise(function (resolve, reject) {
    electronFetch(url, options)
      .then((response) => {
        response.text()
          .then((body) => {
            if (response.status >= 400) {
              if (response.headers.get('content-type') === 'application/json') {
                response.body = body = JSON.parse(body)
              }

              return reject(new HttpError(response, body))
            }

            if (response.status !== 204) {
              body = JSONbig.parse(body)
            }
            response.body = body
            resolve(response)
          })
          .catch(reject)
      })
      .catch(reject)
  })
}

/**
 * @summary Call an URL with GET method
 * @param {string} url URL to call
 * @param {Object} headers HTTP headers
 * @returns {Promise} Promise object
 */
exports.get = function (url, headers = {}) {
  return this.request(url, {
    method: 'GET',
    headers,
  })
}

/**
 * @summary Call an URL with POST method
 * @param {string} url URL to call
 * @param {Object} form Data to submit
 * @param {Object} headers HTTP headers
 * @returns {Promise} Promise object
 */
exports.post = function (url, form, headers = {}) {
  return this.request(url, {
    method: 'POST',
    body: querystring.stringify(form),
    headers,
  })
}
