const inject = require('instill')

/* istanbul ignore next */
inject(exports, {
  getTar: () => require('tar-fs'),
  fs: require('fs-extra'),
})

/**
 * @summary Untar a file
 * @param {string} filePath - the path to the file
 * @param {string} targetDirectory - the target directory
 * @returns {Promise} A promise that resolve when the untar operation is finished
 */
exports.untar = function (filePath, targetDirectory) {
  const {
    getTar,
    fs,
  } = this.modules

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    const tarStream = getTar().extract(targetDirectory)
    stream.pipe(tarStream)
    tarStream.on('error', reject)
    tarStream.on('finish', resolve)
  })
}
