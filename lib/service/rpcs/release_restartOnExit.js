const inject = require('instill')

const execute = function (gameSession, callback) {
  const {
    service,
  } = this.modules

  const release = service.authorize(gameSession)
  const instanceId = service.getInstanceIdByKey(gameSession)
  release.restartOnExit(instanceId)
  callback()
}

module.exports = inject(execute, {
  service: require('../'),
})
