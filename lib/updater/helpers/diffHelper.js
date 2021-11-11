const deepCopy = require('deep-copy')

const PACK_FILE_RATIO = 0.5
/**
 * @summary DiffHelper
 */
class DiffHelper {
  /**
   *
   * @param {string[]} fragments - Fragments
   * @param {Object} localHashes - Local hashes
   * @param {Object} remoteHashes - Remote hashes
   * @param {Object} dependencies - Dependencies
   */
  constructor(fragments, localHashes, remoteHashes, dependencies = {
    updateHelper: require('./updateHelper'),
  }) {
    this.fragments = fragments
    this.localHashes = deepCopy(localHashes)
    this.remoteHashes = remoteHashes
    this.dependencies = dependencies
  }

  /**
   * @summary create promise
   * @returns {Promise<Object>} Promise
   */
  createPromise() {
    const {
      fragments,
      remoteHashes,
    } = this

    const {
      updateHelper,
    } = this.dependencies

    return new Promise((resolve) => {
      this.diff = {}
	  console.log(fragments);
	  console.log(Object.keys(remoteHashes));
      updateHelper.verifyFragmentsList(fragments, remoteHashes)

      this.findFilesToDownloadAndFragmentsToDelete()
      this.checkPacks()
      this.markRemainingFilesToBeDeleted()
      resolve(this.diff)
    })
  }

  /**
   * @summary Find files to download, and fragments to delete
   * @returns {undefined} void
   */
  findFilesToDownloadAndFragmentsToDelete() {
    const {
      fragments,
      remoteHashes,
    } = this

    const {
      localHashes,
    } = this

    for (let fragmentName in remoteHashes) {
      const remoteFragment = remoteHashes[fragmentName]
      const localFragment = localHashes[fragmentName]
      const isFragmentIgnored = !fragments.includes(fragmentName)

      if (!localFragment && isFragmentIgnored) {
        continue
      }

      this.createEmptyFragmentIfNeeded(fragmentName)

      for (let fileName in remoteFragment.files) {
        const remoteFile = remoteFragment.files[fileName]
        const localFile = localFragment && localFragment.files[fileName]

        if (localFile && isFragmentIgnored) {
          continue // will be marked for deletion on second pass; see markRemainingFilesToBeDeleted
        }

        const sameHash = localFile && remoteFile.hash === localFile.hash
        let sameExecutable = true
        if (process.platform !== 'win32' && localFile) {
          sameExecutable = !!remoteFile.executable === !!localFile.executable
        }

        if (!sameHash || !sameExecutable) {
          this.diff[fragmentName].files[fileName] = {
            isPack: false,
            download: !sameHash, // download file if hash has changed
            updatePermissions: !sameExecutable, // update permissions if executable has changed
            hash: remoteFile.hash,
            size: remoteFile.size,
            executable: !!remoteFile.executable,
          }

          if (remoteFragment.archives && remoteFragment.archives[fileName]) {
            /* istanbul ignore next */
            if (!this.diff[fragmentName].archives) {
              this.diff[fragmentName].archives = {}
            }
            this.diff[fragmentName].archives[fileName] = remoteFragment.archives[fileName]
          }

          if (!this.diff[fragmentName].hashes.hasOwnProperty(remoteFile.hash)) {
            this.diff[fragmentName].hashes[remoteFile.hash] = []
          }
          this.diff[fragmentName].hashes[remoteFile.hash].push({
            fileName,
            size: remoteFile.size,
            executable: !!remoteFile.executable,
          })
        }

        if (localFragment) {
          delete localFragment.files[fileName]
          if (localFragment.archives && localFragment.archives[fileName]) {
            delete localFragment.archives[fileName]
          }
        }
      }
    }
  }

  /**
   * @summary Check if packs must be downloaded instead of files
   * @returns {undefined}
   */
  checkPacks() {
    const {
      remoteHashes,
    } = this

    Object.keys(remoteHashes).forEach((fragmentName) => {
      const remoteFragment = remoteHashes[fragmentName]
      if (remoteFragment.hasOwnProperty('packs') && this.diff.hasOwnProperty(fragmentName)) {
        const fragmentDiff = this.diff[fragmentName]
        const remotePacks = remoteFragment.packs
        this.checkPacksInFragment(remotePacks, fragmentDiff)
      }
    })
  }

  /**
   * @summary Check if packs of a fragment must be downloaded instead of files
   * @param {Object} packs - the packs of the fragment
   * @param {Objec} fragmentDiff - the diff of the fragment
   * @returns {undefined}
   */
  checkPacksInFragment(packs, fragmentDiff) {
    Object.keys(packs).forEach((packHash) => {
      const pack = packs[packHash]
      this.checkPack(fragmentDiff, packHash, pack)
    })
  }

  /**
   * @summary Check if pack must be downloaded instead of files
   * @param {Object} fragmentDiff - the fragment diff
   * @param {string} packHash - the hash of the pack to check
   * @param {Object} pack - the pack to check
   * @returns {undefined} void
   */
  checkPack(fragmentDiff, packHash, pack) {
    const filesInPack = this.getFilesInPack(pack, fragmentDiff)

    if (this.mustDownloadPack(pack, filesInPack)) {
      // do not download the files
      Object.keys(filesInPack).forEach((fileName) => {
        fragmentDiff.files[fileName].download = false
      })

      // add the pack to the diff
      fragmentDiff.files[packHash] = {
        download: true,
        isPack: true,
        packFiles: filesInPack,
        hash: packHash,
        size: pack.size,
      }
    }
  }

  /**
   * @summary Returns the files of the fragmentDiff that are present in the pack
   * @param {Object} pack - the pack
   * @param {Object} fragmentDiff - the fragment diff
   * @returns {Object} the files of the fragmentDiff that are present in the pack
   */
  getFilesInPack(pack, fragmentDiff) {
    const filesInPack = {}
    const diffHashes = fragmentDiff.hashes

    // compute the number of files that need to be downloaded and in the pack
    pack.hashes.forEach((fileHash) => {
      if (diffHashes.hasOwnProperty(fileHash)) {
        const files = diffHashes[fileHash]
        files.forEach((file) => {
          filesInPack[file.fileName] = {
            hash: fileHash,
            size: file.size,
            executable: !!file.executable,
          }
        })
      }
    })

    return filesInPack
  }

  /**
   * @summary Check if the pack must be downloaded instead of the independent files
   * @param {Object} pack - the pack
   * @param {Object} filesInPack - the files in the diff that are present in the pack
   * @returns {Boolean} true if the pack must be downloaded
   */
  mustDownloadPack(pack, filesInPack) {
    return Object.keys(filesInPack).length > pack.hashes.length * PACK_FILE_RATIO
  }

  /**
   * @summary Mask all remaining files in the local object instance as to be deleted
   * @returns {undefined} void
   */
  markRemainingFilesToBeDeleted() {
    const {
      updateHelper,
    } = this.dependencies

    const {
      localHashes,
    } = this

    for (let fragmentName in localHashes) {
      const localFragment = localHashes[fragmentName]
      this.createEmptyFragmentIfNeeded(fragmentName)

      for (let fileName in localFragment.files) {
        if (!updateHelper.isFileMarkedForDownload(this.diff, fileName)) {
          this.diff[fragmentName].files[fileName] = updateHelper.createDeletedFile()
        }
      }
    }
  }

  /**
   * @summary Create a new empty fragment in the diff if it does not already exists
   * @param {String} fragment - fragment name
   * @returns {undefined} void
   */
  createEmptyFragmentIfNeeded(fragment) {
    if (!this.diff[fragment]) {
      this.diff[fragment] = {
        files: {},
        hashes: {},
        archives: {},
      }
    }
  }
}

module.exports = DiffHelper
