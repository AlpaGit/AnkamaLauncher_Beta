/**
 * This module manages avatars:
 * - current user avatar
 * - download of images
 * - cache system
 *
 * @module zaap/avatar
 */
const path = require('path')
const crypto = require('crypto')
const inject = require('instill')

inject(exports, {
  fs: require('fs-extra'),
  electronFetch: require('electron-fetch'),
  logger: require('./logger'),
  app: require('./app'),
  haapi: require('./haapi'),
  buildConfig: require('./buildConfig'),
})

/**
 * Before returning, checks on haapi if avatar has changed.
 * If it changed, the new one is downloaded if it is unknown.
 *
 * @summary Get local avatar image path.
 * @returns {Promise} Local path to avatar. In case of error, path default avatar image.
 */
exports.getImagePath = function () {
  const {
    fs,
    haapi,
    logger,
  } = this.modules

  const avatarsPath = this.getAvatarsPath()
  fs.mkdirpSync(avatarsPath)

  return new Promise((resolve, reject) => {
    haapi.get('ankama.account.avatar')
      .then((haapiResponse) => {
        const filePath = path.join(avatarsPath, this.getLocalFileName(haapiResponse.url))
        if (fs.existsSync(filePath)) {
          resolve(filePath)
        } else {
          return this.downloadBinaryFile(haapiResponse.url, filePath)
            .then(() => {
              resolve(filePath)
            })
            .catch((error) => {
              logger.error(error)
              reject(new Error(`Could not download avatar image from "${haapiResponse.url}"`))
            })
        }
      })
      .catch((error) => {
        logger.error(error)
        reject(new Error('Could not fetch avatar. Cannot connect to ankama.account.avatar api.'))
      })
  })
}

/**
 * @summary Return md5 hash of the filename
 * @param {string} url source url
 * @returns {String} md5 filename
 */
exports.getLocalFileName = function (url) {
  const md5 = crypto.createHash('md5').update(url).digest('hex')
  return `${md5}.png`
}

/**
 * @summary Downloads a file from url and save it to disk
 * @param {string} url source url
 * @param {string} filePath local destination file path
 * @returns {Promise} ...guess what
 */
exports.downloadBinaryFile = function (url, filePath) {
  const {
    fs,
    electronFetch,
    buildConfig,
  } = this.modules

  return new Promise((resolve, reject) => {
    const options = {
      timeout: 2000,
      useElectronNet: !buildConfig.allowInsecureHttps,
    }

    electronFetch(url, options)
      .then((response) => {
        if (response.status !== 200) {
          return reject(new Error(`Could not download avatar image from "${url}"`))
        }

        response.body.pipe(fs.createWriteStream(filePath))
          .on('error', reject)
          .on('finish', resolve)
      })
      .catch(reject)
  })
}

/**
 * @summary Get storage location of avatars
 * @returns {String} The path to avatars
 */
exports.getAvatarsPath = function () {
  const {
    app,
  } = this.modules

  return path.join(app.getPath('userCache'), 'avatars')
}
