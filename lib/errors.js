/**
 * The errors function is a utility module to help with the
 * categorisation of errors within a given context.
 *
 * @module zaap/errors
 */
const util = require('util')

/**
 * @summary Error Utility class for Zaap
 * @param {Number} code - Error code
 * @param {String} message - Custom message
 * @param {String} translationKey - Translation key
 * @param {object} translationParameters - Translation parameters
 *
 * @public
 * @constructor
 */
const ZaapError = function (code, message, translationKey, translationParameters = {}) {
  Error.captureStackTrace(this, this.constructor)

  this.label = registry.codes[code]

  if (this.label === undefined) {
    throw new Error(`Error code does not exist! (code: ${code})`)
  }

  this.code = code
  this.message = message
  this.translationKey = translationKey
  this.translationParameters = translationParameters
}

util.inherits(ZaapError, Error)
exports.ZaapError = ZaapError

const registry = exports.registry = {
  labels: {},
  codes: {},
}

/**
 * This will add an `error` attribute to your object,
 * containing a factory function to generate each errors.
 *
 * Example:
 *
 * ```javascript
 * const {
 *   errors,
 *   ZaapError
 * } = require('errors').register('MODULENAME', {
 *   MY_ERROR: 5000
 * })
 *
 * throw new ZaapError(errors.MY_ERROR, 'Contextualised error message')
 * ```
 *
 * @summary Register errors for a given context
 * @param {String} prefix - Prefix to attach to the error label upon emission
 * @param {Object} errorCodes - Name of the errors
 * @returns {Object} errorClassAndCodes {errors: codes, ZaapError}
 */
exports.register = function (prefix, errorCodes) {
  const errorLabels = Object.keys(errorCodes)
  errorLabels.forEach(function (label) {
    const code = errorCodes[label]
    label = `${prefix}_${label}`

    const existingLabel = registry.codes[code]
    if (existingLabel !== undefined) {
      throw new Error(`Cannot assign error code ${code} to ${label}, already assigned to label ${existingLabel}`)
    }

    registry.codes[code] = label

    const existingCode = registry.labels[label]
    if (existingCode !== undefined) {
      throw new Error(`Cannot assign label ${label} to code ${code}, label already has assigned code ${existingCode}`)
    }

    registry.labels[label] = code
  })

  return {
    errors: new Proxy(errorCodes, {
      get: function (target, key) {
        if (key === 'toJSON') {
          return function () {
            return JSON.stringify(target)
          }
        }

        const code = target[key]
        if (code === undefined) {
          throw new Error(`Error code not found for label ${key}`)
        }

        return code
      },
      set: function (target, key, code) {
        throw new Error(`You cannot re-define an error code! (key: ${key}, code: ${code})`)
      },
    }),
    ZaapError,
  }
}
