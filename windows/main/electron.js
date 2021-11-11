const remoteCommunication = require('../../lib/remoteCommunication')
const electron = require('electron')
const BrowserWindow = electron.BrowserWindow
const path = require('path')
const buildConfig = electron.app.modules.getBuildConfig()

if (buildConfig.internal) {
  // Devtools
  const devtoolsPath = path.join(__dirname, 'devtools')
  const devtools = BrowserWindow.getDevToolsExtensions()

  /* istanbul ignore next */
  if (!devtools['Vue.js devtools']) {
    // Note: this activates the tool for all windows!
    electron.BrowserWindow.addDevToolsExtension(devtoolsPath)
  }
}

let completed = false
let window = null
let loadingCompletedCallback = null

function dispatchIsFocusedIpcEvent() {
  setImmediate(() => {
    window.webContents.send(remoteCommunication.CHANNELS.WINDOW_IS_FOCUSED, window.isFocused())
  })
}

function dispatchIsMaximizedIpcEvent() {
  setImmediate(() => {
    window.webContents.send(remoteCommunication.CHANNELS.WINDOW_IS_MAXIMIZED, window.isMaximized())
  })
}

function dispatchIsFullscreenIpcEvent() {
  setImmediate(() => {
    window.webContents.send(remoteCommunication.CHANNELS.WINDOW_IS_FULLSCREEN, window.isFullScreen())
  })
}

exports = module.exports = function (win, callback) {
  completed = false
  window = win
  loadingCompletedCallback = callback

  // IPC Focused
  window.on('blur', dispatchIsFocusedIpcEvent)
  window.on('focus', dispatchIsFocusedIpcEvent)

  // IPC Maximized
  window.on('maximize', dispatchIsMaximizedIpcEvent)
  window.on('unmaximize', dispatchIsMaximizedIpcEvent)

  // IPC Fullscreen
  window.on('enter-full-screen', dispatchIsFullscreenIpcEvent)
  window.on('leave-full-screen', dispatchIsFullscreenIpcEvent)

  const windowPath = path.join(__dirname, 'window.html')
  win.loadURL('file://' + windowPath)
}

exports.getWindow = function () {
  return window
}

exports.show = function () {
  window.show()
  exports.dispatchAllIpcEvents()
}

exports.hide = function () {
  window.hide()
}

exports.maximize = function () {
  if (window.isFullScreen()) {
    window.setFullScreen(false)
  } else if (window.isMaximized()) {
    window.unmaximize()
  } else {
    window.maximize()
  }
  exports.dispatchAllIpcEvents()
}

exports.minimize = function () {
  window.minimize()
}

exports.close = function () {
  window.close()
}

exports.loadingCompleted = function () {
  if (!completed) {
    completed = true
    loadingCompletedCallback(null, true)
    loadingCompletedCallback = null
  }
  exports.dispatchAllIpcEvents()
}

exports.dispatchAllIpcEvents = function () {
  dispatchIsMaximizedIpcEvent()
  dispatchIsFullscreenIpcEvent()
}
