/**
 * Note: we do not use the service.createAuthorized
 * method and instead do the authorization manually here because
 * the code injection done by instill would conflict with it otherwise.
 */
const service = require('../')
const inject = require('instill')

const execute = function (gameSession, gameId, callback) {
  const {
    auth,
  } = this.modules

  const {
    ErrorCode,
    ZaapError: ZaapProtocolError,
  } = service.TYPES

  try {
    service.authorize(gameSession)

    auth.createToken(gameId)
      .then(function (token) {
        callback(null, token)
      })
      .catch((error) => {
        if (error.statusCode === 601) {
          return callback(new ZaapProtocolError({code: ErrorCode['AUTH_' + error.reason]}))
        }
        callback(error)
      })
  } catch (error) {
    callback(error)
  }
}

module.exports = inject(execute, {
  auth: require('../../auth'),
})
