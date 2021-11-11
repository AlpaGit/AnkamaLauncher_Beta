const service = require('../')

module.exports = service.createAuthorizedMethod(function (release, callback) {
  callback(null, release.isUpdateAvailable())
})
