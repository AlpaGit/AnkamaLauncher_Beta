const inject = require('instill')

const execute = function (gameName, releaseName, instanceId, hash, callback) {
  const {
    service,
  } = this.modules

  const {
    ErrorCode,
    ZaapError: ZaapProtocolError,
  } = service.TYPES

  const release = service.validateCredentials(gameName, releaseName, instanceId, hash)

  if (!release) {
    return callback(new ZaapProtocolError({code: ErrorCode.INVALID_CREDENTIALS}))
  }

  release.setIsLaunching(false)

  const key = service.createKeyForReleaseProcessId(release, instanceId)

  callback(null, key)
}

module.exports = inject(execute, {
  service: require('../'),
})
