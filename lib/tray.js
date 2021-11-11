/**
 * Module which manages tray icon on Windows and Linux
 *
 * @module zaap/tray
 */
const {Menu, Tray, ipcMain} = require('electron')
const path = require('path')
const inject = require('instill')

inject(exports, {
  app: require('./app'),
  autoUpdater: require('./autoUpdater'),
  remoteCommunication: require('./remoteCommunication'),
  buildConfig: require('./buildConfig'),
})

let tray = null
let contextMenuTemplate = null

/**
 * @summary Setup the tray icon with context menu
 * @returns {Tray} - Built tray menu.
 */
exports.setup = function () {
  const {
    app,
    autoUpdater,
    remoteCommunication,
    buildConfig,
  } = this.modules

  const additionalMenus = []
  if (buildConfig.internal) {
    additionalMenus.push(
      {type: 'separator'},
      {role: 'toggledevtools'}
    )
  }

  contextMenuTemplate = [
    {
      label: 'Open ' + app.getName(),
      click() {
        if (!app.windows.main) {
          return false
        }

        app.openWindow('main')
      },
    },
    {
      label: 'Parameters',
      click() {
        if (!app.windows.main) {
          return false
        }

        app.openWindow('main')

        function openParameters() {
          app.windows.main.activeWindow.send(remoteCommunication.CHANNELS.ZAAP_SETTINGS_OPEN)
        }

        if (app.windows.main.activeWindow) {
          openParameters()
        } else {
          ipcMain.once(remoteCommunication.CHANNELS.MAIN_WINDOW_FULLY_LOADED, () => {
            process.nextTick(openParameters)
          })
        }
      },
    },
    ...additionalMenus,
    {type: 'separator'},
    {
      label: 'Check for updates',
      click() {
        autoUpdater.checkForUpdates()
      },
    },
    {type: 'separator'},
    {role: 'quit'},
  ]

  const trayIconPath = path.join(app.getAppPath(), 'tray/icon.png')
  tray = new Tray(trayIconPath)

  tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate))
  tray.setToolTip(app.getName())
  tray.on('click', () => {
    if (!app.windows.main) {
      return false
    }

    app.openWindow('main')
  })

  return tray
}

/**
 * @summary Get the current tray context menu template.
 * @returns {null|array} - Tray context menu template.
 */
exports.getContextMenuTemplate = function () {
  return contextMenuTemplate
}
