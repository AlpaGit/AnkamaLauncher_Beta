/**
 * This module manage Ankama terms of use
 *
 * @module zaap/terms
 */
const path = require('path')
const promisify = require('es6-promisify').promisify
const ipcMain = require('electron').ipcMain
const remoteCommunication = require('./remoteCommunication')
const inject = require('instill')

inject(exports, {
  fs: require('fs-extra'),
  app: require('./app'),
  settings: require('./settings'),
  haapi: require('./haapi'),
  logger: require('./logger'),
})

/**
 * @summary Setup the terms
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    app,
    logger,
  } = this.modules

  ipcMain.on(remoteCommunication.CHANNELS.TERMS_GET, (event) => {
    event.returnValue = this.get()
  })

  ipcMain.on(remoteCommunication.CHANNELS.TERMS_ACCEPT, () => {
    this.accept()
      .catch((error) => {
        logger.error('terms: cannot accept', error)
      })
  })

  ipcMain.on(remoteCommunication.CHANNELS.TERMS_REFUSE, () => {
    app.quit()
  })

  ipcMain.on(remoteCommunication.CHANNELS.TERMS_NEEDS_TO_ACCEPT_NEW_VERSION, (event) => {
    event.returnValue = this.needsToAcceptNewVersion()
  })
}

/**
 * @summary Fetch terms of use from Haapi for all languages, cache them to files
 * @returns {Promise} Promise object
 */
exports.update = function () {
  const {
    fs,
    settings,
  } = this.modules

  /**
   * minimize request number to haapi:
   * update the terms for all languages only if the first language has been updated
   */

  const supportedLanguages = settings.supportedLanguages
  return this.updateLanguage(supportedLanguages[0])
    .then((termsHasBeenUpdated) => {
      let storedTerms = [supportedLanguages[0]]
      if (!termsHasBeenUpdated) {
        storedTerms = fs.readdirSync(this.getTermsPath()).map((filename) => {
          return filename.substring(0, 2)
        })

        if (storedTerms.length === supportedLanguages.length) {
          return
        }
      }

      const otherLanguages = supportedLanguages.filter((language) => {
        return !storedTerms.includes(language)
      })

      let updatedLanguagePromises = otherLanguages.map((language) => {
        return this.updateLanguage(language)
      })

      return Promise.all(updatedLanguagePromises)
    })
}

/**
 * @summary Fetch terms of use from Haapi for specific language, cache them to files
 * @param {string} language - the language
 * @returns {Promise<Boolean>} Promise object, with true if the terms has been updated, false if not
 */
exports.updateLanguage = function (language) {
  const {
    haapi,
  } = this.modules

  let termsKnownVersion = null
  try {
    const termsOnDisk = this.get(language)
    termsKnownVersion = termsOnDisk.currentVersion
  } catch (error) { }

  return haapi.get('ankama.legal.terms', language, termsKnownVersion)
    .then((response) => {
      if (!response) {
        return false
      }

      return this.writeTermsToDisk(language, response)
        .then(() => true)
    })
}

/**
 * @summary Write terms to disk
 * @param {string} language - the terms language
 * @param {object} termsData - the terms data
 * @returns {Promise} Promise object
 */
exports.writeTermsToDisk = function (language, termsData) {
  const {
    fs,
  } = this.modules

  const writeFile = promisify(fs.writeFile)

  const termsPath = this.getTermsPath()
  fs.mkdirpSync(termsPath)

  const filePath = path.join(termsPath, `${language}.json`)
  const fileData = JSON.stringify(termsData)
  return writeFile(filePath, fileData)
}

/**
 * @summary Get terms of use
 * @param {string} language - Language in which fetch terms, take zaap current language by default
 * @returns {JSON} Terms data
 */
exports.get = function (language) {
  const {
    fs,
    settings,
  } = this.modules

  language = language || settings.get(settings.KEYS.LANGUAGE)
  const filePath = path.join(this.getTermsPath(), `${language}.json`)

  return JSON.parse(fs.readFileSync(filePath))
}

exports.getCurrentVersion = function () {
  const {
    settings,
  } = this.modules

  return this.get(settings.defaultLanguage).currentVersion
}

/**
 * @summary Check if user needs to accept terms
 * @returns {Boolean} returns true if user needs to accept new version of terms
 */
exports.needsToAcceptNewVersion = function () {
  const {
    settings,
  } = this.modules

  const acceptedTermsVersion = settings.get(settings.KEYS.ACCEPTED_TERMS_VERSION)
  if (!acceptedTermsVersion) {
    return true
  }

  const currentTermsVersion = this.getCurrentVersion()

  return currentTermsVersion > acceptedTermsVersion
}

/**
 * @summary Save current version as last accepted terms version
 * @returns {Promise} - When the terms version are sended
 */
exports.accept = function () {
  const {
    settings,
    haapi,
    logger,
  } = this.modules

  const version = this.getCurrentVersion()
  settings.set(settings.KEYS.ACCEPTED_TERMS_VERSION, version)
  return haapi.get('ankama.legal.setTouVersion', version)
    .then(() => {
      logger.info('terms: cgu version sent')
    })
}

/**
 * @summary Get the location of where data about repositories will be stored.
 * @returns {String} The path to where data for all know repositories are stored.
 */
exports.getTermsPath = function () {
  const {
    app,
  } = this.modules

  return path.join(app.getPath('userData'), 'terms')
}
