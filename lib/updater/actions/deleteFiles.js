const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const PromisePool = require('../../promisePool')
const path = require('path')

const DELETE_CONCURRENCY = 10

/**
 * @summary UpdateActionDeleteFiles
 */
class UpdateActionDeleteFiles extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} Promise
   */
  createPromise() {
    this.deletedFiles = {}
    const diff = this.params.diff

    return new ControllablePromise((resolve, reject) => {
      const self = this
      const generatePromises = function* () {
        for (let fragmentName in diff) {
          const fragmentFiles = diff[fragmentName].files
          for (let filePath in fragmentFiles) {
            const fileData = fragmentFiles[filePath]
            if (fileData.size === 0 && !self.findFileInOtherFragments(fragmentName, filePath)) {
              yield self.unlinkFile(fragmentName, filePath)
            }
          }
        }
      }

      const promiseIterator = generatePromises()
      const pool = PromisePool(promiseIterator, DELETE_CONCURRENCY)

      pool.start()
        .then(() => {
          resolve(this.deletedFiles)
        })
        .catch(reject)
    })
  }

  /**
   * @summary Check if a file is in another fragment (and not deleted)
   * @param {string} fileFragmentName - the fragment's name of the file
   * @param {string} filePath - the file path
   * @returns {boolean} True if the the file is in another fragment
   */
  findFileInOtherFragments(fileFragmentName, filePath) {
    const diff = this.params.diff

    for (let fragmentName in diff) {
      if (fragmentName !== fileFragmentName) {
        if (this.findFileInFragment(fragmentName, filePath)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * @summary Check if a file is in a fragment (and not deleted)
   * @param {string} fragmentName - the name of the fragment
   * @param {string} filePath - the file path
   * @returns {boolean} True if the the file is in the fragment
   */
  findFileInFragment(fragmentName, filePath) {
    const diff = this.params.diff

    const fragmentFiles = diff[fragmentName].files
    if (fragmentFiles.hasOwnProperty(filePath)) {
      const fileData = fragmentFiles[filePath]
      return fileData.size > 0
    }

    return false
  }

  /**
   * @summary Delete a file
   * @param {String} fragmentName - fragment of the file
   * @param {String} filePath - relative path of the file
   * @returns {Promise} A promise that is resolved when the file has been deleted
   */
  unlinkFile(fragmentName, filePath) {
    const {
      location,
    } = this

    const {
      fs,
    } = this.dependencies

    return new Promise((resolve) => {
      const absoluteFilepath = path.join(location, filePath)
      fs.unlink(absoluteFilepath, (error) => {
        if (!error) {
          this.getOrCreateFragmentArray(fragmentName).push(filePath)
        }
        resolve()
      })
    })
  }

  /**
   * @summary Get the fragment array
   * @param {String} fragmentName - fragment of the file
   * @returns {Array} Fragment array
   */
  getOrCreateFragmentArray(fragmentName) {
    if (!this.deletedFiles[fragmentName]) {
      this.deletedFiles[fragmentName] = []
    }

    return this.deletedFiles[fragmentName]
  }
}

module.exports = UpdateActionDeleteFiles
