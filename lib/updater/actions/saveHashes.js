const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const path = require('path')

/**
 * @summary UpdateActionSaveHashes
 */
class UpdateActionSaveHashes extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} void
   */
  createPromise() {
    const {
      fs,
      updateHelper,
    } = this.dependencies

    const {
      localHashes,
    } = this.params

    return new ControllablePromise((resolve, reject) => {
      this.addDownloadedHashes()
      this.addDownloadedArchives()
      this.removeDeletedFragments()

      const dataToWrite = Object.entries(localHashes)
        .reduce((acc, [fragmentName, fragment]) => {
          const files = fragment.files && Object.entries(fragment.files)
            .filter(([, data]) => data !== undefined)
            .reduce((acc, [filename, { hash, size, executable }]) => {
              acc[filename] = { hash, size, executable }
              return acc
            }, {})

          const archives = fragment.archives && Object.keys(fragment.archives)
            .reduce((acc, archive) => {
              acc[archive] = fragment.archives[archive]
              return acc
            }, {})

          acc[fragmentName] = Object.assign({}, fragment, { files, archives })

          return acc
        }, {})

      const hashesFilePath = path.join(this.location, updateHelper.hashesFileName)
      fs.writeFile(hashesFilePath, JSON.stringify(dataToWrite), (error) => {
        if (error) {
          return reject(error)
        }

        resolve()
      })
    })
  }

  /**
   * @summary Add downloaded hashes to the local hashes
   * @returns {undefined} void
   */
  addDownloadedHashes() {
    const {
      downloadedHashes,
    } = this.params

    Object.keys(downloadedHashes).forEach((fragmentName) => {
      this.addDownloadedFragmentToHashes(fragmentName, downloadedHashes[fragmentName])
    })
  }

  /**
   * @summary Add downloaded archives to the local hashes
   * @returns {undefined} void
   */
  addDownloadedArchives() {
    const {
      downloadedArchives,
      localHashes,
    } = this.params

    if (!downloadedArchives) {
      return
    }


    Object.keys(downloadedArchives).forEach((fragment) => {
      const archives = downloadedArchives[fragment]

      /* istanbul ignore next */
      if (!localHashes[fragment].archives) {
        localHashes[fragment].archives = {}
      }

      Object.keys(archives).forEach((archiveName) => {
        localHashes[fragment].archives[archiveName] = archives[archiveName]
      })
    })
  }

  /**
   * @summary Add a downloaded fragment to the local hashes
   * @param {String} fragmentName - name of the fragment
   * @param {Object} fragment - fragment
   * @returns {undefined} void
   */
  addDownloadedFragmentToHashes(fragmentName, fragment) {
    this.createEmptyFragmentIfNeeded(fragmentName)
    Object.keys(fragment.files).forEach((filePath) => {
      this.addDownloadedFileToHashes(fragmentName, filePath, fragment.files[filePath])
    })
  }

  /**
   * @summary Create an empty fragment in the local hashes
   * @param {String} fragmentName - name of the fragment
   * @returns {undefined} void
   */
  createEmptyFragmentIfNeeded(fragmentName) {
    const {
      localHashes,
    } = this.params

    if (!localHashes[fragmentName]) {
      localHashes[fragmentName] = {
        files: {},
        archives: {},
      }
    }
  }

  /**
   * @summary Add a downloaded file to the local hashes
   * @param {String} fragmentName - name of the fragment
   * @param {String} filePath - path of the file
   * @param {Object} file - file
   * @returns {undefined} void
   */
  addDownloadedFileToHashes(fragmentName, filePath, file) {
    const {
      localHashes,
    } = this.params

    localHashes[fragmentName].files[filePath] = file
  }

  /**
   * @summary Remove the deleted fragments from the local hashes
   * @returns {undefined} void
   */
  removeDeletedFragments() {
    const {
      deletedFiles,
    } = this.params

    Object.keys(deletedFiles).forEach((fragmentName) => {
      this.removeDeletedFragmentFromHashes(fragmentName, deletedFiles[fragmentName])
    })
  }

  /**
   * @summary Remove a deleted fragment from the local hashes
   * @param {String} fragmentName - name of the fragment
   * @param {Object} fragment - fragment
   * @returns {undefined} void
   */
  removeDeletedFragmentFromHashes(fragmentName, fragment) {
    fragment.forEach((filePath) => {
      this.removeDeletedFileFromHashes(fragmentName, filePath)
    })
  }

  /**
   * @summary Remove a deleted file from the local hashes
   * @param {String} fragmentName - name of the fragment
   * @param {String} filePath - path of the file
   * @returns {undefined} void
   */
  removeDeletedFileFromHashes(fragmentName, filePath) {
    const {
      localHashes,
    } = this.params

    delete localHashes[fragmentName].files[filePath]
  }
}

module.exports = UpdateActionSaveHashes
