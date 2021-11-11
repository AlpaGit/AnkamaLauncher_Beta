const service = require('../')
const inject = require('instill')

const execute = function (gameSession, callback) {
  const {
    settings,
  } = this.modules

  const {
    ErrorCode,
    ZaapError: ZaapProtocolError,
  } = service.TYPES

  const {
    USER_INFO_UNAVAILABLE,
  } = ErrorCode

  service.authorize(gameSession)

  const userInfo = settings.get(settings.KEYS.USER_INFO)

  if (userInfo === undefined) {
    return callback(new ZaapProtocolError({code: USER_INFO_UNAVAILABLE}))
  }

  callback(null, JSON.stringify(userInfo))
}

module.exports = inject(execute, {
  settings: require('../../settings'),
})
