/**
 * Abstract the go ankama logic
 *
 * @module zaap/goAnkama
 */
const inject = require('instill')
const ipcMain = require('electron').ipcMain
const remoteCommunication = require('./remoteCommunication')

inject(exports, {
  settings: require('./settings'),
  buildConfig: require('./buildConfig'),
})

exports.setup = function () {
  ipcMain.on(remoteCommunication.CHANNELS.GO_ANKAMA_GET_URL, (event, keyword) => {
    event.returnValue = this.getUrl(keyword)
  })
}

exports.getUrl = function (keyword) {
  const {
    settings,
    buildConfig,
  } = this.modules

  const baseUrl = buildConfig.ankama.go
  const language = settings.get(settings.KEYS.LANGUAGE)

  return baseUrl + language + '/go/' + keyword
}
