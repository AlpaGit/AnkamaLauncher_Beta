const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const path = require('path')
const PromisePool = require('../../promisePool')

const REPAIR_CONCURRENCY = 10

/**
 * @summary UpdateActionRepair
 */
class UpdateActionRepair extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} Promise
   */
  createPromise() {
    const {
      fragments,
      remoteHashes,
    } = this.params

    const {
      updateHelper,
    } = this.dependencies

    this.hashes = {}
    this.filesProgress = 0
    this.filesToRepair = []

    return new ControllablePromise((resolve, reject, progress) => {
      updateHelper.verifyFragmentsList(fragments, remoteHashes)
      this.computeFilesToRepair()

      const self = this
      const generatePromises = function* () {
        for (let i = 0; i < self.filesToRepair.length; i += 1) {
          const {
            fragmentName,
            filePath,
          } = self.filesToRepair[i]

          yield self.repairFile(fragmentName, filePath)
            .then(() => {
              self.filesProgress += 1
              self.notifyProgress(progress)
            })
        }
      }

      const promiseIterator = generatePromises()
      const pool = PromisePool(promiseIterator, REPAIR_CONCURRENCY)

      pool.start()
        .then(() => {
          resolve(this.hashes)
        })
        .catch(reject)
    })
  }

  /**
   * @summary Compute the files to repair
   * @returns {undefined} void
   */
  computeFilesToRepair() {
    const {
      fragments,
      remoteHashes,
    } = this.params

    Object.keys(remoteHashes).forEach((fragmentName) => {
      const fragmentFiles = remoteHashes[fragmentName].files
      if (fragments.includes(fragmentName)) {
        this.hashes[fragmentName] = {files: {}}
        Object.keys(fragmentFiles).forEach((filePath) => {
          this.filesToRepair.push({fragmentName, filePath})
        })
      }
    })
  }

  /**
   * @summary Repair a file
   * @param {String} fragmentName - the name of the fragment
   * @param {String} filePath - the path of the file
   * @returns {Promise} a promise that resolve if there is no error
   */
  repairFile(fragmentName, filePath) {
    const {
      location,
      dependencies,
    } = this

    const {
      cryptoHelper,
      logger,
    } = dependencies

    return new Promise((resolve) => {
      const absoluteFilePath = path.join(location, filePath)
      Promise.all([
        this.getFileExecutableMode(absoluteFilePath),
        cryptoHelper.getFileHash(absoluteFilePath),
      ])
        .then(([executable, hash]) => {
          this.hashes[fragmentName].files[filePath] = {
            hash,
            executable,
          }
          resolve()
        })
        .catch((error) => {
          logger.debug('repair: cannot get file hash/executable mode. Mark file as broken.', error)
          this.hashes[fragmentName].files[filePath] = {
            hash: '',
          }
          resolve()
        })
    })
  }

  /**
   * @summary Return the executable mode of the file
   * @param {String} absoluteFilePath - absolute path of the file
   * @returns {Promise} a promise that resolve with the executable mode of the file
   */
  getFileExecutableMode(absoluteFilePath) {
    const {
      fs,
    } = this.dependencies

    return new Promise((resolve, reject) => {
      fs.lstat(absoluteFilePath, (error, stats) => {
        if (error) {
          reject(error)
          return
        }

        const executableFlags = stats.mode & parseInt('111', 8)
        resolve(executableFlags !== 0)
      })
    })
  }

  /**
   * @summary Notify the progress
   * @param {Function} progress - progress function
   * @returns {undefined} void
   */
  notifyProgress(progress) {
    const {
      filesProgress,
      filesToRepair,
    } = this

    progress({
      filesProgress,
      filesTotal: filesToRepair.length,
    })
  }
}

module.exports = UpdateActionRepair
