const service = require('../')
const {
  ErrorCode,
  ZaapError: ZaapProtocolError,
} = service.TYPES

const {
  SETTINGS_KEY_NOT_FOUND,
  SETTINGS_INVALID_VALUE,
} = ErrorCode

module.exports = service.createAuthorizedMethod(function (release, key, value, callback) {
  if (release.settings.get()[key] === undefined) {
    return callback(new ZaapProtocolError({
      code: SETTINGS_KEY_NOT_FOUND,
      message: key,
    }))
  }

  try {
    release.settings.set({
      [key]: JSON.parse(value),
    })
  } catch (error) {
    return callback(new ZaapProtocolError({
      code: SETTINGS_INVALID_VALUE,
      message: error.message,
    }))
  }

  callback()
})
