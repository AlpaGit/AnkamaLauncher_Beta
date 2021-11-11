/**
 * The core of the application.
 *
 * Essentially acts as a window manager.
 *
 * @module zaap/app
 */
const path = require('path')
const electron = require('electron')
const ipcMain = electron.ipcMain
const remoteCommunication = require('./remoteCommunication')

const inject = require('instill')

const render = require('./render')
const logger = require('./logger')

const BrowserWindow = electron.BrowserWindow

// We encapsulate exit, see at the bottom of the file
const exit = electron.app.exit

// We also encapsulate getAppPath
const getAppPath = electron.app.getAppPath

// We also encapsulate getLoginItemSettings
const getLoginItemSettings = electron.app.getLoginItemSettings

// Need to do this so that I may bind additional functions to exports,
// this way JSDocs properly picks up the tags and generate the documentation
// correctly
exports = module.exports = electron.app

// Save CPU cycles
// Details: https://pracucci.com/electron-slow-background-performances.html
exports.commandLine.appendSwitch('disable-renderer-backgrounding')
// Enable any GPU
exports.commandLine.appendSwitch('ignore-gpu-blacklist')

// Save quitting state in app
exports.isQuitting = false

/* istanbul ignore next */
inject(exports, {
  fs: require('fs-extra'),
  service: require('./service'),
  getAppPath: function () {
    return getAppPath.call(electron.app)
  },
  getAppDock: function () {
    return electron.app.dock
  },
  getLoginItemSettings: function () {
    return getLoginItemSettings.call(electron.app)
  },
  // We encapsulate in a function to avoid circular dependencies issues
  getBuildConfig: function () {
    return require('./buildConfig')
  },
  settings: require('./settings'),
  exit: function (code) {
    return exit.call(electron, code)
  },
})

electron.app.on('ready', function () {
  const {
    settings,
  } = this.modules

  settings.setup()

  // Use our own protocol handler for file://
  electron.protocol.interceptBufferProtocol('file', render.loadFromRequest.bind(render))
})

/**
 * Allow us to know if app was opened at OS boot or by user
 * because we want to open main window if user open the app
 * but we want to keep the app in tray if it was launched
 * on boot
 *
 * @summary Get the way app was opened
 * @returns {boolean} App was opened as hidden
 */
exports.wasOpenedAsHidden = function () {
  const {
    getLoginItemSettings,
  } = this.modules

  if (process.platform === 'darwin') {
    return getLoginItemSettings().wasOpenedAsHidden || this.checkHiddenFile()
  }

  return process.argv.includes('--hidden') || this.checkHiddenFile()
}

/**
 * @summary Return the path to the file that tells zaap to open as hidden
 * @returns {string} Path to the file that tells zaap to open as hidden
 */
exports.getHiddenFilePath = function () {
  return path.join(this.getPath('userData'), '.startHidden')
}

/**
 * @summary Check if the file that tells zaap to open as hidden exists, and delete it
 * @returns {undefined} void
 */
exports.checkHiddenFile = function () {
  const {
    fs,
  } = this.modules

  const filePath = this.getHiddenFilePath()
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
    } catch (error) {
      logger.error('app: unable to delete openAsHidden file', error)
    }

    return true
  }

  return false
}

/**
 * @summary Create a file that will tell zaap to open as hidden
 * @returns {undefined} void
 */
exports.createHiddenFile = function () {
  const {
    fs,
  } = this.modules

  try {
    const filePath = this.getHiddenFilePath()
    fs.writeFileSync(filePath, '')
  } catch (error) {
    logger.error('app: unable to create openAsHidden file', error)
  }
}

/**
 * Setup will configure where user data and cache data should
 * be stored, and will ensure that only a single version of this
 * app is running; if another copy of the same version of zaap is
 * found to be running, the currently running version will receive a
 * signal and the new version will quit.
 *
 * @summary Setup the application
 * @returns {electron.app} The current application
 */
exports.setup = function () {
  const {
    getBuildConfig,
    settings,
    fs,
  } = this.modules

  const buildConfig = getBuildConfig()
  this.requestSingleInstanceLock()
  
  this.on('second-instance', function (event, argv, cwd) {
    this.exit(0)
  })
  
  
  // Setup all path depending on build config name
  this.setName(buildConfig.productName)
  this.setPath('userData', path.join(this.getPath('appData'), buildConfig.name))
  this.setPath('userCache', path.join(this.getPath('cache'), buildConfig.name))
  settings.setPath(path.join(this.getPath('userData'), 'Settings'))
  fs.mkdirpSync(this.getPath('userData'))

  ipcMain.on(remoteCommunication.CHANNELS.ZAAP_QUIT, () => {
    this.quit()
  })

  this.on('before-quit', () => {
    this.isQuitting = true
  })

  return this
}

/**
 * Read information about all available windows
 * (./app/windows), and keep them in memory
 *
 * @property {Object} windows The list of loaded and available windows.
 */
exports.windows = {}

/**
 * @summary Load all windows from a given directory.
 * @param {string} windowsPath - The location where the windows can be found.
 * @returns {undefined} void
 */
exports.loadWindows = function (windowsPath) {
  const {
    fs,
  } = this.modules

  const windowsList = fs.readdirSync(windowsPath)
  const windows = windowsList.reduce(function (accumulator, windowName) {
    let windowPath = path.join(windowsPath, windowName)
    let config

    try {
      let configPath = path.join(windowPath, 'package.json')
      logger.info('boot: Loading window config:', configPath)
      config = require(configPath)
    } catch (error) {
      /* istanbul ignore next */
      throw new Error(`Failed to load config file for window: ${windowName}, error: ${error.message}`)
    }

    config.path = windowPath
    config.window = config.window || {}
    config.show = false

    const electronFilePath = path.join(windowPath, 'electron')

    try {
      config.loader = require(electronFilePath)
    } catch (ex) {
      logger.warn(`app: window ${windowName} has no electron.js file`)
    }

    accumulator[windowName] = config

    return accumulator
  }, {})

  logger.info('boot: Available windows:', windowsList)

  this.windows = windows
}

/**
 * @summary Close and unload all windows.
 * @returns {undefined} void
 */
exports.unloadWindows = function () {
  Object.keys(this.windows).forEach((name) => {
    this.closeWindow(name)
  })

  this.windows = {}
}

/**
 * @summary Open a window.
 * @param {string} windowName - The name of the window to close.
 * @returns {electron.BrowserWindow} BrowserWindow instance.
 */
exports.openWindow = function (windowName) {
  const {
    settings,
    getAppDock,
  } = this.modules

  let config = this.windows[windowName]

  if (!config) {
    logger.error(`app.openWindow: Window not found: ${windowName}`)
    throw new Error(`app.openWindow: Window not found: ${windowName}`)
  }

  if (!config.activeWindow && config.opening) {
    logger.warn('app.openWindow: trying to a open window which is already opening but not yet ready')
    return null
  }

  if (config.activeWindow) {
    logger.info(`app.openWindow: Window ${windowName} already open, returning current instance`)
    config.activeWindow.show()
    config.activeWindow.restore()
    config.activeWindow.focus()

    /* istanbul ignore next */
    if (getAppDock()) {
      getAppDock().show()
    }

    return config.activeWindow
  }

  config.opening = true

  const windowsState = settings.get(settings.KEYS.WINDOWS_STATE)
  let windowBounds = null
  let windowIsMaximized = false
  if (windowsState && windowsState.hasOwnProperty(windowName)) {
    windowBounds = windowsState[windowName].bounds
    windowIsMaximized = windowsState[windowName].isMaximized
  } else {
    const hasCenterProperty = config.window.hasOwnProperty('center')
    if ((!hasCenterProperty && !config.window.hasOwnProperty('x') && !config.window.hasOwnProperty('y'))
      || (hasCenterProperty && config.window.center === true)) {
      delete config.window.center
      const {width, height} = electron.screen.getPrimaryDisplay().size
      config.window.x = Math.ceil(width / 2 - config.window.width / 2)
      config.window.y = Math.ceil(height / 2 - config.window.height / 2)
    }

    if (config.window.x && config.window.y) {
      windowBounds = config.window
    }
  }

  logger.info(`app.openWindow: opening window ${windowName}`, config.window)

  const win = new BrowserWindow(config.window)

  if (windowBounds) {
    process.nextTick(() => {
      win.setBounds(windowBounds)
      if (windowIsMaximized) {
        win.maximize()
      }
      win.show()
    })
  }

  win.on('close', (event) => {
    if (!this.isQuitting) {
      logger.info(`app: window ${windowName} was hidden, because we are not quitting`)
      win.hide()
      /* istanbul ignore next */
      if (getAppDock()) {
        getAppDock().hide()
      }
      event.preventDefault()
      return false
    }

    settings.set(settings.KEYS.WINDOWS_STATE + '.' + windowName, {
      bounds: win.getBounds(),
      isMaximized: win.isMaximized(),
    })
    config.activeWindow = null
    config.opening = false
    logger.info(`app: window ${windowName} was closed`)
  })

  function loadURL(error, completed) {
    /* istanbul ignore next */
    if (error) {
      throw error
    }

    if (!completed) {
      win.loadURL(`file://${config.path}/window.html`)
      win.show()
      /* istanbul ignore next */
      if (getAppDock()) {
        getAppDock().show()
      }
    }

    config.activeWindow = win
    config.opening = false
  }

  if (config.loader && typeof config.loader === 'function') {
    config.loader(win, loadURL)
  } else {
    process.nextTick(loadURL)
  }

  return win
}

/**
 * @summary Close a window.
 * @param {string} windowName - The name of the window to close.
 * @returns {boolean} True if the window was found and closed, false otherwise.
 */
exports.closeWindow = function (windowName) {
  let config = this.windows[windowName]

  if (!config) {
    logger.error(`app.closeWindow: Window not found: ${windowName}`)
    throw new Error(`app.closeWindow: Window not found: ${windowName}`)
  }

  if (!config.activeWindow) {
    logger.warn(`app.closeWindow: tried to close ${windowName} is not open`)
    return false
  }

  logger.info(`app.closeWindow: closing window ${windowName}`)
  config.activeWindow.close()

  return true
}

/**
 * During development, we start electron from the project's directory;
 * because of this, electron's `getAppPath` would return the project's
 * directory, and not the `./app` directory as it should.
 *
 * To palliate to this, we have customised a bit the function to
 * return process.cwd() during development, but electron's `getAppPath`
 * function return value when in builds.
 *
 * @summary Get the application's path
 * @returns {String} Path to the application's location on disk.
 */
exports.getAppPath = function () {
  const cwd = process.cwd()
  const appPath = this.modules.getAppPath()

  // We assume this is the development environment
  if (cwd.startsWith(appPath)) {
    return cwd
  }

  return appPath
}

/**
 * Note that exit can be overridden in certain situations:
 *
 *   - When games are connected to the service API
 *
 * In such cases, `exit` will override the exit process, and return
 * false. However, if an error code is received that is greater than 0,
 * we will exit no matter what (since we exit because of an internal error).
 *
 * @summary Exit the application.
 * @param {Number} code - exit code
 * @returns {boolean} - was the application exited. `false` means the exit was canceled.
 */
/* istanbul ignore next */
exports.exit = function (code = 0) {
  const {
    service,
  } = this.modules

  if (service.hasConnectedProcesses() && code === 0) {
    logger.warn('Cannot exit, games are connected to the service API')
    return false
  }

  this.isQuitting = true

  this.unloadWindows()
  logger.info(`app.exit: code ${code}`)
  this.modules.exit(code)
  return true
}

/**
 * Note: you will need to reload the page in any open window for this to take effect.
 *
 * @summary Disable webview animations.
 * @property {boolean} animations - Enable/disable animations when we open a window.
 */
exports.animate = true
