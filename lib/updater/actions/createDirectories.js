const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const PromisePool = require('../../promisePool')
const path = require('path')

const CREATE_DIRECTORY_CONCURRENCY = 10

/**
 * @summary UpdateActionCreateDirectories
 */
class UpdateActionCreateDirectories extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} void
   */
  createPromise() {
    const {
      diff,
      fragment,
    } = this.params

    const fragmentFiles = diff[fragment].files

    const self = this
    const generatePromises = function* () {
      for (let filePath of Object.keys(fragmentFiles)) {
        const fileData = fragmentFiles[filePath]
        if (fileData.size !== 0) {
          yield self.createDirectory(filePath)
        }
      }
    }

    const promiseIterator = generatePromises()
    const pool = PromisePool(promiseIterator, CREATE_DIRECTORY_CONCURRENCY)

    return new ControllablePromise((resolve, reject) => {
      pool.start()
        .then(resolve)
        .catch(reject)
    })
  }

  /**
   * @summary Create a directory
   * @param {String} filePath - directory of the file for which a directory must be created
   * @returns {Promise} Promise object
   */
  createDirectory(filePath) {
    const {
      fs,
    } = this.dependencies

    return new Promise((resolve, reject) => {
      const absoluteFilepath = path.join(this.location, filePath)
      const absoluteFileDir = path.dirname(absoluteFilepath)

      if (fs.existsSync(absoluteFileDir)) {
        return resolve()
      }

      fs.mkdirp(absoluteFileDir, (error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

module.exports = UpdateActionCreateDirectories
