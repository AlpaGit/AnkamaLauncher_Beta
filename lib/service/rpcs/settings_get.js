const service = require('../')

const {
  ErrorCode,
  ZaapError: ZaapProtocolError,
} = service.TYPES

const {
  SETTINGS_KEY_NOT_FOUND,
} = ErrorCode

module.exports = service.createAuthorizedMethod(function (release, key, callback) {
  const setting = release.settings.get()[key]

  if (setting === undefined) {
    return callback(new ZaapProtocolError({
      code: SETTINGS_KEY_NOT_FOUND,
      message: key,
    }))
  }

  callback(null, JSON.stringify(setting))
})
