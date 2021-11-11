const fs = require('fs')
const path = require('path')
const { promisify } = require('es6-promisify')

/**
 *  Get the size of the folder (with all files recursively)
 * @function getFolderSize
 * @param  {string} dir Dir path string.
 * @return {Promise<number>} Resolves when the size of the directory is computed
 */
function getFolderSize(dir, {
  fsReadDirAsync = promisify(fs.readdir),
  fsStatAsync = promisify(fs.lstat),
} = {}) {
  return fsReadDirAsync(dir)
    .then((childs) => {
      const filePromises = childs.map((fileName) => {
        const filePath = path.join(dir, fileName)
        return fsStatAsync(filePath).then((fileStat) => {
          if (fileStat.isDirectory()) {
            return getFolderSize(filePath, {
              fsReadDirAsync,
              fsStatAsync,
            })
          }

          return fileStat.size
        })
      })
      return Promise.all(filePromises)
        .then((fileSizes) => {
          return fileSizes.reduce((total, fileSize) => total + fileSize, 0)
        })
    })
}

module.exports = getFolderSize
