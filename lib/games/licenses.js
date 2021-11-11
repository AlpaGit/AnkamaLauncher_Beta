/**
 * @summary Game licenses
 * @module zaap/games/licenses
 */

const path = require('path')
const inject = require('instill')

inject(exports, {
  fs: require('fs'),
})

/**
 * @summary Create a licenses array and save it to a license.json file
 * @param {String|Boolean} licensesFolder - The license folder name or false if not given
 * @param {String} releasePath - Where the release is installed
 * @param {String} releaseDataPath - Where to write licenses.json to
 * @returns {Array} The licenses
 */
exports.create = function (licensesFolder, releasePath, releaseDataPath) {
  const {
    fs,
  } = this.modules

  if (!licensesFolder) {
    return false
  }

  const licensesPath = path.join(releasePath, licensesFolder)

  // ensure license folder exists
  if (!fs.existsSync(licensesPath)) {
    return false
  }

  // create the licenses array
  const licenses = fs.readdirSync(licensesPath)
    .map(filename => {
      const filePath = path.join(licensesPath, filename)
      return {
        name: path.basename(filename, '.txt'),
        extension: path.extname(filePath),
        path: filePath,
      }
    })
    .filter(file => file.extension === '.txt')
    .map(file => ({
      title: file.name,
      text: fs.readFileSync(file.path, 'utf8')
        .replace(/(?:\r\n|\r|\n)/g, '<br />'),
    }))

  // save to disk
  fs.writeFileSync(
    path.join(releaseDataPath, 'licenses.json'),
    JSON.stringify(licenses),
    'utf8'
  )

  return licenses
}

/**
 * @summary Get licenses from the license.json file
 * @param {String|Boolean} licensesFolder - The license folder name or false if not given
 * @param {String} releaseDataPath - Where to write licenses.json to
 * @returns {Array} The licenses
 */
exports.get = function (licensesFolder, releaseDataPath) {
  const {
    fs,
  } = this.modules

  if (!licensesFolder) {
    return false
  }

  const licensesFile = path.join(releaseDataPath, 'licenses.json')

  // ensure licenses.json exists
  if (!fs.existsSync(licensesFile)) {
    return false
  }

  return JSON.parse(fs.readFileSync(licensesFile, 'utf8'))
}
