/**
 * This module provides two functionalities:
 *
 *   1. It captures all `file://` loads from the webview, and parse any HTML files
 *   2. It provides a function for loading and parsing HTML5 contents
 *
 * For now, we only make it so that trying to load a file from /
 * will be relative to the app's folder.
 *
 * @module zaap/renderer
 */
const path = require('path')
const mime = require('mime')
const inject = require('instill')

const logger = require('./logger')

let filePrefix = 'file://'

/* istanbul ignore next */
if (process.platform === 'win32') {
  filePrefix += '/'
}

/* istanbul ignore next */
inject(exports, {
  fs: require('fs'),
  getAppPath: function () {
    const app = require('./app')
    return app.getAppPath()
  },
})

/**
 * @summary Get a file from disk
 * @param {string} file - File path.
 * @param {render~renderCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.render = function (file, callback) {
  let fileInfo

  if (typeof file !== 'string') {
    return callback(new Error(`Render needs file to be a string, received: ${file}`))
  }

  file = decodeURI(file)

  if (file.substring(0, filePrefix.length) === filePrefix) {
    file = file.substring(filePrefix.length)
  }

  if (file.includes('?')) {
    file = file.substring(0, file.indexOf('?'))
  }

  fileInfo = path.parse(file)
  let mimeType = mime.getType(fileInfo.ext)

  function proceed(data) {
    /**
     * @callback render~renderCallback
     * @param {Error|null} error - Error object (or null if no errors).
     * @param {Object} fileinfo - File information.
     * @param {Buffer} fileinfo.data - File data.
     * @param {String} fileinfo.mimeType - MIME type of the file.
     */
    callback(null, { data: data, mimeType: mimeType })
  }

  this.modules.fs.readFile(file, (err, data) => {
    if (err) {
      let fileFromRoot = path.join(this.modules.getAppPath(), file.substring(fileInfo.root.length))

      return this.modules.fs.readFile(fileFromRoot, function (err, data) {
        if (err) {
          logger.debug(`render: failed to load ${file}, ${fileFromRoot}`, err)
          return callback(err)
        }

        proceed(data)
      })
    }

    proceed(data)
  })
}

/**
 * This is used as a callback for electron's `protocol.interceptBufferProtocol`.
 *
 * See https://github.com/electron/electron/blob/master/docs/api/protocol.md
 * for more details.
 *
 * @summary Load a file from disk.
 * @param {Object} request - Request object.
 * @param {string} request.url - File URL (file://...).
 * @param {render~loadFromRequestCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.loadFromRequest = function (request, callback) {
  this.render(request.url, function (err, info) {
    /**
     * @callback render~loadFromRequestCallback
     * @param {Error|Object} - Error object, or file object if no errors.
     */
    if (err) {
      return callback(err)
    }

    callback(info)
  })
}

/**
 * @summary Get a file from disk.
 * @param {string} file - File path.
 * @param {render~loadCallback} callback - Callback function.
 * @returns {undefined} void
 */
exports.load = function (file, callback) {
  /**
   * @callback render~loadCallback
   * @param {Error|null} error - Error object
   * @param {Buffer} data - file data.
   */
  this.render(file, function (err, info) {
    callback(err, err ? null : info.data)
  })
}
