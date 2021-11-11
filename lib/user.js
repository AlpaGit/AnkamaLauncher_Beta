/**
 * User module manage all user-related
 * but non-auth things
 *
 * @module zaap/user
 */
const remoteCommunication = require('./remoteCommunication')
const inject = require('instill')

inject(exports, {
  settings: require('./settings'),
  haapi: require('./haapi'),
  buildConfig: require('./buildConfig'),
  avatar: require('./avatar'),
  logger: require('./logger'),
  ipcMain: require('electron').ipcMain,
  registry: require('./games/registry'),
})

exports.HAAPI_NICKNAME_ERRORS = {
  ANKAMA_NICKNAME_EXIST: 'haapi.nickname.exist',
  ANKAMA_NICKNAME_BADLEN: 'haapi.nickname.badlen',
  ANKAMA_NICKNAME_BADFORMAT: 'haapi.nickname.badformat',
  ANKAMA_NICKNAME_BAN: 'haapi.nickname.ban',
  GAME_NICKNAME_DIFFERENT: 'haapi.nickname.different',
}

/**
 * @summary Start the ipc communication between the main and renderer process
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    ipcMain,
  } = this.modules

  ipcMain.on(remoteCommunication.CHANNELS.USER_SET_NICKNAME, this.setNickname.bind(this))
}

/**
 * @summary ipcMain event handler for USER_SET_NICKNAME: update userInfo.nickname or send an error
 * @param {Object} event - event
 * @param {string} nickname - nickname
 * @returns {Promise} When the nickname is updated
 */
exports.setNickname = function (event, nickname) {
  const {
    settings,
    logger,
    haapi,
  } = this.modules

  const {
    LANGUAGE,
    USER_INFO,
  } = settings.KEYS

  const {
    USER_NICKNAME_ERROR,
  } = remoteCommunication.CHANNELS

  const lang = settings.get(LANGUAGE)

  return haapi.get('ankama.account.setNicknameWithApiKey', nickname, lang)
    .then(() => {
      const userInfo = settings.get(USER_INFO)
      userInfo.nickname = nickname
      settings.set(USER_INFO, userInfo)
      logger.debug('user: set nickname', nickname)
    })
    .catch((error) => {
      switch (error.statusCode) {
        case 602:
        case 604:
          event.sender.send(USER_NICKNAME_ERROR, {
            translationKey: this.HAAPI_NICKNAME_ERRORS[error.body.key.toUpperCase()],
          })
          logger.debug(`user: nickname error ${error.statusCode}: ${error.message}`)
          break

        case 649:
          event.sender.send(USER_NICKNAME_ERROR, {
            translationKey: this.HAAPI_NICKNAME_ERRORS[error.body.key.toUpperCase()],
            translationParameters: error.body.suggests,
          })
          logger.debug(`user: nickname error ${error.statusCode}: ${error.message}`)
          break

        default:
          logger.error('user: nickname error', error)
      }
    })
}

/**
 * @summary Fetch up to date user status (accepted terms, early access) from Haapi
 * @returns {Promise} When user status is up to date
 */
exports.updateStatus = function () {
  const {
    haapi,
    settings,
  } = this.modules

  const {
    ACCEPTED_TERMS_VERSION,
  } = settings.KEYS

  return haapi.get('ankama.account.status')
    .then((status) => {
      // accepted terms version
      const zaapAcceptedTermsVersion = settings.get(ACCEPTED_TERMS_VERSION)
      const haapiAcceptedTermsVersion = status.acceptedTermsVersion
      if (haapiAcceptedTermsVersion > zaapAcceptedTermsVersion) {
        settings.set(ACCEPTED_TERMS_VERSION, haapiAcceptedTermsVersion)
      }
    })
}

/**
 * @summary Set the user info & fetch the avatar
 * @param {Object} userInfo - the user info
 * @returns {Promise} When the avatar is up to date
 */
exports.setInfo = function (userInfo) {
  const {
    settings,
    avatar,
    buildConfig,
    logger,
  } = this.modules

  const {
    USER_INFO,
  } = settings.KEYS

  userInfo.isAnkamaUser = !!buildConfig.internal

  const oldUserInfo = settings.get(USER_INFO)
  if (oldUserInfo && oldUserInfo.avatar) {
    userInfo.avatar = oldUserInfo.avatar
  }

  settings.set(USER_INFO, userInfo)

  // then get the avatar (if the avatar fails, the user info is available)
  return avatar.getImagePath()
    .then((avatar) => {
      userInfo.avatar = avatar
      settings.set(USER_INFO, userInfo)
    })
    .catch((error) => {
      logger.debug('user: cannot get avatar image path', error)
    })
}

/**
 * @summary Set the user origin as last open release
 * @returns {Promise} When the last open release is set up
 */
exports.setOrigin = function () {
  const {
    haapi,
    settings,
    logger,
    registry,
  } = this.modules

  const {
    LAST_OPENED_RELEASE,
  } = settings.KEYS

  if (typeof settings.get(LAST_OPENED_RELEASE) !== 'undefined') {
    return Promise.resolve()
  }

  return haapi.get('ankama.account.originWithApiKey')
    .then((origin) => {
      const gameId = Number(origin.value)
      const game = Object.values(registry.games).find(game => game.id === gameId)
      if (!game) {
        return Object.values(registry.games)[0].uid
      }
      return game.uid
    })
    .catch((error) => {
      if (error.statusCode !== 404) {
        /* istanbul ignore next */
        logger.error('auth: unable to get account origin', error, origin)
      }
      const game = Object.values(registry.games)[0]
      /* istanbul ignore next */
      if (game) {
        return game.uid
      }
    })
    .then((gameUid) => {
      settings.set(LAST_OPENED_RELEASE, { gameUid, name: 'main' })
    })
}
