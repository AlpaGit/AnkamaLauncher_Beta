/**
 * This module manages KPI tracking
 *
 * @module zaap/kpi
 */
const inject = require('instill')
const deepCopy = require('deep-copy')
const remoteCommunication = require('./remoteCommunication')

const { exec } = require('child_process')
const { readFile, unlink } = require('fs')
const { promisify } = require('es6-promisify')

inject(exports, {
  device: require('./device'),
  haapi: require('./haapi'),
  logger: require('./logger'),
  settings: require('./settings'),
  connectivity: require('./connectivity'),
  registry: require('./games/registry'),
  electron: require('electron'),
  os: require('os'),
})

let gamesResolve = null
const gamesLoaded = new Promise((resolve) => gamesResolve = resolve)

exports.EVENT_ID = {
  SESSION_LAUNCH: 659,
  GAME_INSTALL: 660,
  GAME_UNINSTALL: 661,
  GAME_LAUNCH: 662,
  NAVIGATION_PUSH: 663,
  NAVIGATION_GAME: 664,
  GAME_UPDATE: 677,
  SESSION_CONFIG: 684,
}

const FUNNEL_STEP = {
  HIT: 'HIT',
  START: 'START',
  END: 'END',
  CANCEL: 'CANCEL',
  SEC30: 'SEC30',
}

exports.MAX_EVENTS = 5
exports.accountSessionId = null
exports.events = []

const GAME_ID = 102
const CONNECTION_TYPE = 'ANKAMA'
const CLIENT_TYPE = 'STANDALONE'
const DEVICE = 'PC'

const OS_NAMES = {
  win32: 'WINDOWS',
  darwin: 'MACOS',
  linux: 'LINUX',
}

const OS_NAME = OS_NAMES[process.platform]

let gameSessionId = null

const gamesClicked = []
const pushClicked = []

let isSetup = false

/**
 * @summary Set up the ipcMain event listeners
 * @returns {undefined} void
 */
exports.setup = function () {
  if (isSetup) {
    return
  }

  isSetup = true

  const {
    settings,
    electron,
  } = this.modules

  electron.ipcMain.on(
    remoteCommunication.CHANNELS.ZAAP_SETTINGS_SET,
    (event, key) => {
      if (key === settings.KEYS.LAST_OPENED_RELEASE) {
        this.navigationGame()
      }
    }
  )

  electron.ipcMain.on(
    remoteCommunication.CHANNELS.RELEASE_NEWS_CLICK,
    (event, pushId, pushType) => {
      this.navigationPush(pushId, pushType)
    }
  )
}

/**
 * @summary Get the user account id
 * @returns {string} The account id
 */
exports.getAccountId = function () {
  const {
    settings,
  } = this.modules

  return settings.get(settings.KEYS.USER_INFO).id
}

/**
 * @summary Get some information of the currently selected release
 * @returns {Object} The game infos
 */
exports.getGameInfo = function () {
  const {
    settings,
    registry,
  } = this.modules

  let gameUid = ''
  let releaseName = ''

  const lastOpenedRelease = settings.get(settings.KEYS.LAST_OPENED_RELEASE)
  const gameUids = Object.keys(registry.games)

  if (!!lastOpenedRelease && gameUids.includes(lastOpenedRelease.gameUid)) {
    gameUid = lastOpenedRelease.gameUid
    releaseName = lastOpenedRelease.name
  } else {
    gameUid = gameUids.filter(uid => 'main' in registry.games[uid].releases)[0]
    releaseName = 'main'
  }

  const game = registry.games[gameUid]
  /* istanbul ignore next */
  if (!game) {
    return false
  }
  const release = game.releases[releaseName]

  const gameId = !game.id ? null : game.id
  const isBeta = releaseName !== 'main'

  return {
    gameId,
    releaseId: !gameId ? null : gameId * (isBeta ? -1 : 1),
    isInstalled: release.isInstalled(),
    launchSession: release.runningInstances.length + 1,
  }
}

/**
 * @summary Returns the gameId of the release, negative if not the main release
 * @param {Object} release - The release object
 * @returns {Number} The positive or negative gameId
 */
function getRelativeGameId(release) {
  const isBeta = release.name !== 'main'
  return release.gameId * (isBeta ? -1 : 1)
}

/**
 * @summary Convert release settings keys to their corresponding short keys
 * @param {Object} settingsByGameIds - The release settings object
 * @returns {Object} The settings object with keys converted
 */
exports.shortKeys = function (settingsByGameIds) {
  const {
    settings,
  } = this.modules

  const {
    AUTO_UPDATE,
    DISPLAY_ALL_RELEASES,
  } = settings.KEYS

  const SHORT_KEYS = {
    [AUTO_UPDATE]: 'AU',
    [DISPLAY_ALL_RELEASES]: 'DAR',
  }

  return Object.keys(settingsByGameIds).reduce((acc, key) => {
    const shortKey = SHORT_KEYS[key]
    if (!!shortKey) {
      acc[shortKey] = settingsByGameIds[key]
    }
    return acc
  }, {})
}

/**
 * @summary Get the game_id list of already installed games
 * @returns {array} An array of game_id (ex: [1, -1, 3])
 */
exports.getInstalledGames = function () {
  const {
    registry,
  } = this.modules

  return Object.values(registry.games).reduce((games, game) =>
    Object.assign({}, games,
      Object.values(game.releases).reduce((releases, release) => {
        if (!!release.gameId && release.isInstalled()) {
          releases[getRelativeGameId(release)] = !release.settings
            ? {}
            : this.shortKeys(release.settings.get())
        }
        return releases
      }, {}))
    , {})
}

/**
 * @summary Return the state of the session
 * @returns {boolean} True if the game is started
 */
exports.isStarted = function () {
  return gameSessionId !== null
}

/**
 * @summary Sign on, start the session, send device infos, add session_launch event and setup event listeners
 * @returns {Promise} When the session is started
 */
exports.start = function () {
  const {
    logger,
    registry,
  } = this.modules

  if (registry.gamesLoaded) {
    gamesResolve()
  } else {
    registry.once('gamesLoaded', () => {
      gamesResolve()
    })
  }

  return this.startSession()
    .then(() => {
      this.sendDeviceInfos()
        .catch((error) => {
          logger.error('kpi: cannot send device infos', error)
        })
      return gamesLoaded
    })
    .then(() => {
      this.sessionLaunch()
      this.sessionConfig()
      this.setup()
    })
    .catch((error) => {
      logger.error('KPI', error)
    })
}

/**
 * @summary Send last events, end the session and sign off
 * @returns {Promise} When signed off
 */
exports.end = function () {
  const {
    logger,
  } = this.modules

  if (!this.isStarted()) {
    return Promise.resolve()
  }

  return Promise.all([
    this.sendEvents(),
    this.endSession(),
  ]).then(() => {
    gamesClicked.length = 0
    pushClicked.length = 0
  }).catch((error) => {
    logger.error('KPI', error)
    gameSessionId = null
    this.accountSessionId = null
  })
}

/**
 * @summary Sign on
 * @returns {Promise} Object with id and account
 */
exports.signOn = function () {
  const {
    haapi,
    logger,
  } = this.modules

  return haapi.get('ankama.account.signOnWithApiKey', GAME_ID)
    .then((result) => {
      this.accountSessionId = result.id
      this.start()
        .catch((error) => {
          logger.error('kpi: cannot start', error)
        })

      logger.debug('KPI: signed on')
      return result
    })
    .catch((error) => {
      logger.error('KPI: unable to sign on', error)
    })
}

/**
 * @summary Start the session
 * @returns {Promise} Promise object with gameSessionId
 */
exports.startSession = function () {
  const {
    haapi,
    logger,
  } = this.modules

  return haapi.get(
    'ankama.game.startSessionWithApiKey',
    this.accountSessionId,
    null,
    null,
    null
  ).then((id) => {
    gameSessionId = id
    logger.debug('KPI: session started')
  })
}

/**
 * @summary End the session
 * @returns {Promise} When the session is ended
 */
exports.endSession = function () {
  const {
    haapi,
    logger,
  } = this.modules

  return haapi.get(
    'ankama.game.endSessionWithApiKey',
    gameSessionId,
    null,
    true
  ).then(() => {
    gameSessionId = null
    this.accountSessionId = null
    logger.debug('KPI: session ended')
  })
}

/**
 * @summary Send device infos
 * @returns {Promise} Device infos are sended
 */
exports.sendDeviceInfos = function () {
  const {
    haapi,
    logger,
    device,
  } = this.modules

  return haapi.get(
    'ankama.account.sendDeviceInfos',
    this.accountSessionId,
    CONNECTION_TYPE,
    CLIENT_TYPE,
    OS_NAME,
    DEVICE,
    null,
    device.getUid()
  ).then(() => {
    logger.debug('KPI: device infos sended')
  })
}

/**
 * @summary Send events stored in the events array
 * @returns {Promise} Events are sent or Haapi error
 */
exports.sendEvents = function () {
  const {
    haapi,
    logger,
  } = this.modules

  if (!this.isStarted() || this.events.length === 0) {
    return Promise.resolve()
  }

  const eventsToSend = deepCopy(this.events)
  this.events.length = 0

  return haapi.get(
    'ankama.game.sendEvents',
    GAME_ID,
    gameSessionId,
    JSON.stringify(eventsToSend)
  ).then(() => {
    logger.debug(`KPI: ${eventsToSend.length} event(s) sended`)
  }).catch(error => {
    this.events = this.events.concat(eventsToSend)
    logger.error('KPI', error)
  })
}

/**
 * @summary Add an event to the events array
 * @param {Number} eventId Event id (ex: 1234)
 * @param {Object} data Data relative to the event
 * @returns {undefined} void
 */
exports.addEvent = function (eventId, data) {
  const {
    logger,
  } = this.modules

  const event = {
    // eslint-disable-next-line camelcase
    event_id: eventId,
    data,
    date: (new Date()).toISOString().slice(0, -1) + '+00:00',
  }

  this.events.push(event)

  logger.debug(`KPI: event ${eventId} added`)

  if (this.events.length >= this.MAX_EVENTS) {
    this.sendEvents()
      .catch((error) => {
        logger.error('kpi: cannot send events', error)
      })
  }
}

/**
 * @summary Add a session_launch event to the events array
 * @returns {undefined} void
 */
exports.sessionLaunch = function () {
  const {
    settings,
  } = this.modules

  const {
    AUTO_LAUNCH,
    STAY_LOGGED_IN,
    LANGUAGE,
  } = settings.KEYS

  const data = {
    /* eslint-disable camelcase */
    account_id: this.getAccountId(),
    connection_game: this.getGameInfo().gameId,
    auto_launch: settings.get(AUTO_LAUNCH),
    auto_connect: settings.get(STAY_LOGGED_IN),
    lang: settings.get(LANGUAGE),
    games_install: JSON.stringify(this.getInstalledGames()),
    /* eslint-enable camelcase */
  }

  this.addEvent(this.EVENT_ID.SESSION_LAUNCH, data)
}

/**
 * Return Screens infos
 *
 * @return {Array} screen infos
 */
exports.getScreensInfos = function () {
  const {
    electron,
  } = this.modules

  const SCREEN_LANDSCAPE = 0
  const SCREEN_PORTRAIT = 1

  const isScreenLandscape = (screen) => {
    return screen.rotation === 0 || screen.rotation === 180
  }

  const TOUCH_SUPPORT = 1
  const TOUCH_NO_SUPPORT = 0

  const hasTouchSupport = (screen) => {
    return screen.touchSupport === 'available'
  }

  const allScreens = electron.screen.getAllDisplays()
  const screensInfos = allScreens.map((screen) => {
    const rotation = isScreenLandscape(screen) ? SCREEN_LANDSCAPE : SCREEN_PORTRAIT
    const touchSupport = hasTouchSupport(screen) ? TOUCH_SUPPORT : TOUCH_NO_SUPPORT
    return [
      screen.bounds.width,
      screen.bounds.height,
      screen.scaleFactor,
      rotation,
      touchSupport,
    ]
  })

  return screensInfos
}

/**
 * Return the computer RAM
 *
 * @return {Number} ram
 */
exports.getComputerRam = function () {
  const {
    os,
  } = this.modules

  return Math.pow(2, Math.round(Math.log(os.totalmem() / 1024 / 1024) / Math.log(2)))
}

/**
 * Return the OS Version
 *
 * @return {Number} version
 */
exports.getOsVersion = function () {
  const {
    os,
  } = this.modules

  const [x, y] = os.release().split('.')
  return parseFloat(`${x}.${y}`)
}

/**
 * Return the average clock speed in MHz
 *
 * @return {Number} version
 */
exports.getAvgClockMhz = function () {
  const {
    os,
  } = this.modules

  const cpus = os.cpus()

  let totalHz = 0
  for (let i = 0; i < cpus.length; i++) {
    totalHz += cpus[i].speed
  }
  const avgHz = totalHz / cpus.length
  return avgHz
}

/**
 * Return DirectX Major Version
 *
 * @return {Promise<Number>} version
 */
exports.getDirectXVersion = function ({
  execAsync = promisify(exec),
  readFileAsync = promisify(readFile),
  unlinkAsync = promisify(unlink),
} = {}) {
  const {
    logger,
  } = this.modules

  const filepath = './dxdiag_backup.txt'
  return execAsync(`dxdiag /t ${filepath}`)
    .then(() => readFileAsync(filepath))
    .then((file) => {
      const content = file.toString()
      const rx = /DirectX Version: DirectX (.*)/
      const match = rx.exec(content)
      if (!match) {
        throw new Error('Can not get DirectX Version')
      }
      return parseInt(match[1], 10)
    })
    .then((version) => {
      unlinkAsync(filepath)
      return version
    })
    .catch((error) => {
      logger.warn('kpi: Unable to get DirectX Version', error)
      return 0
    })
}

/**
 * @summary Add a session_config to the events array
 * @returns {Promsie<undefined>} void
 */
exports.sessionConfig = function ({
  platform = process.platform,
} = {}) {
  const {
    os,
    logger,
  } = this.modules

  const OS_IDS = {
    win32: 0,
    darwin: 1,
    linux: 2,
  }

  const OS_ID = OS_IDS[platform]

  const data = {
    /* eslint-disable camelcase */
    account_id: this.getAccountId(),
    os: OS_ID,
    os_version: this.getOsVersion(),
    os_arch_is64: os.arch() === 'x64',
    proc_freq: this.getAvgClockMhz(),
    proc_cores: os.cpus().length,
    ram: this.getComputerRam(),
    gpu_directx: 0,
    screens: this.getScreensInfos(),
    /* eslint-enable camelcase */
  }

  const directXVersionPromise = OS_ID === 0 ? this.getDirectXVersion() : Promise.resolve(0)

  return directXVersionPromise
    .then((directx) => {
      /* eslint-disable camelcase */
      data.gpu_directx = directx
      /* eslint-enable camelcase */

      logger.debug('SESSION CONFIG', data)

      this.addEvent(this.EVENT_ID.SESSION_CONFIG, data)
    })
}

/**
 * @summary Add a game_install event to the events array
 * @param {string} funnelStep Funnel step key (HIT, START, END, CANCEL)
 * @param {Number} downloadSpeed downloadSpeed
 * @returns {undefined} void
 */
exports.gameInstall = function (funnelStep, downloadSpeed = 0) {
  if (!this.isStarted()) {
    return
  }

  const {
    releaseId,
  } = this.getGameInfo()

  if (releaseId !== null) {
    const data = {
      /* eslint-disable camelcase */
      account_id: this.getAccountId(),
      install_game: releaseId,
      is_auto: false,
      download_speed: downloadSpeed,
      funnel_step: funnelStep,
      /* eslint-enable camelcase */
    }

    this.addEvent(this.EVENT_ID.GAME_INSTALL, data)
  }
}

/**
 * @summary Add a game_install event to the events array when the user clicks on install
 * @returns {undefined} void
 */
exports.gameInstallHit = function () {
  return this.gameInstall(FUNNEL_STEP.HIT)
}

/**
 * @summary Add a game_install event to the events array when the installation starts
 * @returns {undefined} void
 */
exports.gameInstallStart = function () {
  return this.gameInstall(FUNNEL_STEP.START)
}

/**
 * @summary Add a game_install event to the events array when the installation ends
 * @param {Number} downloadSpeed downloadSpeed
 * @returns {undefined} void
 */
exports.gameInstallEnd = function (downloadSpeed) {
  return this.gameInstall(FUNNEL_STEP.END, downloadSpeed)
}

/**
 * @summary Add a game_install event to the events array when the user cancel the installation
 * @returns {undefined} void
 */
exports.gameInstallCancel = function () {
  return this.gameInstall(FUNNEL_STEP.CANCEL)
}

/**
 * @summary Add a game_install event to the events array after 30 secs of download
 * @param {Number} downloadSpeed downloadSpeed
 * @returns {undefined} void
 */
exports.gameInstallSec30 = function (downloadSpeed) {
  return this.gameInstall(FUNNEL_STEP.SEC30, downloadSpeed)
}

/**
 * @summary Add a game_uninstall event to the events array
 * @returns {undefined} void
 */
exports.gameUninstall = function () {
  if (!this.isStarted()) {
    return
  }

  const {
    releaseId,
  } = this.getGameInfo()

  if (releaseId !== null) {
    const data = {
      /* eslint-disable camelcase */
      account_id: this.getAccountId(),
      uninstall_game: releaseId,
      /* eslint-enable camelcase */
    }

    this.addEvent(this.EVENT_ID.GAME_UNINSTALL, data)
  }
}

/**
 * @summary Add a game_launch event to the events array
 * @returns {undefined} void
 */
exports.gameLaunch = function () {
  if (!this.isStarted()) {
    return
  }

  const {
    releaseId,
    launchSession,
  } = this.getGameInfo()

  if (releaseId !== null) {
    const data = {
      /* eslint-disable camelcase */
      account_id: this.getAccountId(),
      launch_game: releaseId,
      launch_session: launchSession,
      /* eslint-enable camelcase */
    }

    this.addEvent(this.EVENT_ID.GAME_LAUNCH, data)
  }
}

/**
 * @summary Add a navigation_push event to the events array
 * @param {string} pushId The push id
 * @param {string} pushType The push type
 * @returns {undefined} void
 */
exports.navigationPush = function (pushId, pushType) {
  if (!this.isStarted()) {
    return
  }

  if (!pushClicked.includes(pushId)) {
    pushClicked.push(pushId)

    const {
      releaseId,
      isInstalled,
    } = this.getGameInfo()

    const data = {
      /* eslint-disable camelcase */
      account_id: this.getAccountId(),
      push_id: parseInt(pushId),
      push_type: pushType,
      push_game: releaseId,
      game_is_install: isInstalled,
      /* eslint-enable camelcase */
    }

    this.addEvent(this.EVENT_ID.NAVIGATION_PUSH, data)
  }
}

/**
 * @summary Add a navigation_game event to the events array
 * @returns {undefined} void
 */
exports.navigationGame = function () {
  if (!this.isStarted()) {
    return
  }

  const {
    releaseId,
    isInstalled,
  } = this.getGameInfo()

  if (!gamesClicked.includes(releaseId) && releaseId !== null) {
    gamesClicked.push(releaseId)

    const data = {
      /* eslint-disable camelcase */
      account_id: this.getAccountId(),
      navigation_game: releaseId,
      game_is_install: isInstalled,
      /* eslint-enable camelcase */
    }

    this.addEvent(this.EVENT_ID.NAVIGATION_GAME, data)
  }
}

/**
 * @summary Add a game_update event to the events array
 * @param {string} funnelStep Funnel step key (HIT, START, END, CANCEL)
 * @param {*} args args
 * @returns {undefined} void
 */
exports.gameUpdate = function (funnelStep, {
  releaseName,
  gameId,
  autoUpdate,
  downloadSpeed = 0,
  updateSize = 0,
  updateFiles = 0,
} = {}) {
  if (!this.isStarted()) {
    return
  }

  const isBeta = releaseName !== 'main'
  const releaseId = isBeta ? gameId * -1 : gameId

  const data = {
    /* eslint-disable camelcase */
    account_id: this.getAccountId(),
    update_game: releaseId,
    is_auto: autoUpdate,
    download_speed: downloadSpeed,
    update_size: updateSize,
    updated_files: updateFiles,
    funnel_step: funnelStep,
    /* eslint-enable camelcase */
  }

  this.addEvent(this.EVENT_ID.GAME_UPDATE, data)
}

/**
* @summary Add a game_update event to the events array when the user clicks on update
* @param {*} args args
* @returns {undefined} void
*/
exports.gameUpdateHit = function (args) {
  return this.gameUpdate(FUNNEL_STEP.HIT, args)
}

/**
* @summary Add a game_update event to the events array when the update starts
* @param {*} args args
* @returns {undefined} void
*/
exports.gameUpdateStart = function (args) {
  return this.gameUpdate(FUNNEL_STEP.START, args)
}

/**
* @summary Add a game_update event to the events array when the update ends
* @param {*} args args
* @returns {undefined} void
*/
exports.gameUpdateEnd = function (args) {
  return this.gameUpdate(FUNNEL_STEP.END, args)
}

/**
* @summary Add a game_update event to the events array when the user cancel the update
* @param {*} args args
* @returns {undefined} void
*/
exports.gameUpdateCancel = function (args) {
  return this.gameUpdate(FUNNEL_STEP.CANCEL, args)
}

