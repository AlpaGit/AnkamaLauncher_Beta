/**
 * This module manage Mac menu
 *
 * @module zaap/menu
 */
const Menu = require('electron').Menu
const inject = require('instill')

inject(exports, {
  app: require('./app'),
  autoUpdater: require('./autoUpdater'),
  buildConfig: require('./buildConfig'),
  remoteCommunication: require('./remoteCommunication'),
  shell: require('electron').shell,
})

/**
 * @summary Build and apply the mac menu
 * @returns {array} - menu template
 */
exports.setup = function () {
  const {
    app,
    autoUpdater,
    buildConfig,
    remoteCommunication,
    shell,
  } = this.modules

  const viewAdditionalMenus = []
  if (buildConfig.internal) {
    viewAdditionalMenus.push(
      {type: 'separator'},
      {role: 'toggledevtools'}
    )
  }

  const menuTemplate = [
    {
      label: app.getName(),
      submenu: [
        {role: 'about'},
        {
          label: 'Check for updates',
          click() {
            autoUpdater.checkForUpdates()
          },
        },
        {type: 'separator'},
        {
          label: 'Preferences',
          accelerator: 'Cmd+,',
          click() {
            if (!app.windows.main) {
              return false
            }

            app.openWindow('main')

            const mainWindow = app.windows.main.activeWindow
            mainWindow.send(remoteCommunication.CHANNELS.ZAAP_SETTINGS_OPEN)
          },
        },
        {type: 'separator'},
        {role: 'hide'},
        {role: 'hideothers'},
        {role: 'unhide'},
        {type: 'separator'},
        {role: 'quit'},
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {role: 'undo'},
        {role: 'redo'},
        {type: 'separator'},
        {role: 'cut'},
        {role: 'copy'},
        {role: 'paste'},
        {role: 'delete'},
        {role: 'selectall'},
      ],
    },
    {
      label: 'View',
      submenu: [
        {role: 'reload'},
        {role: 'togglefullscreen'},
        ...viewAdditionalMenus,
      ],
    },
    {
      role: 'window',
      submenu: [
        {role: 'minimize'},
        {role: 'zoom'},
        {role: 'close'},
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Ankama Support',
          click() {
            shell.openExternal('https://support.ankama.com')
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

  return menuTemplate
}
