const UpdateAction = require('./updateAction')
const ControllablePromise = require('../../controllablePromise')
const PromisePool = require('../../promisePool')
const path = require('path')
const logger = require('../../logger')
const {promiseTry} = require('../../promiseHelper')
const pMap = require('p-map')
const AdapterManager = require('../archives/adapterManager')
const { accessSync } = require('fs')

const PMAP_CONCURRENCY = 2

/**
 * @summary UpdateActionDownloadFragment
 */
class UpdateActionDownloadFragment extends UpdateAction {
  /**
   * @summary create promise
   * @returns {ControllablePromise} Promise
   */
  createPromise() {
    const {
      fs,
      downloadConcurrency,
      buildConfig,
    } = this.dependencies

    return new ControllablePromise((resolve, reject, progress, onPause, onResume, onCancel) => {
      this.fileProgress = {}
      this.downloadedFiles = {}
      this.downloadedArchives = {}
      this.runningPromises = []
      this.chunkSize = 0
      this.tempDirPath = path.join(this.location, `.tmp-${buildConfig.name}-download-parts`)

      this.files = this.params.diff[this.params.fragment].files
      this.archives = this.params.diff[this.params.fragment].archives
      this.progress = progress

      let isPaused = false
      const pendingResolveFunctions = {}

      onPause((resolvePause, rejectPause) => {
        isPaused = true
        this.pauseRunningPromises()
          .then(() => {
            resolvePause()
          })
          .catch(rejectPause)
      })

      onResume((resolveResume, rejectResume) => {
        isPaused = false
        Object.values(pendingResolveFunctions).forEach(resolve => resolve())
        this.resumeRunningPromises()
          .then(resolveResume)
          .catch(rejectResume)
      })

      onCancel((resolveCancel, rejectCancel) => {
        this.cancelRunningPromises()
          .then(() => fs.remove(this.tempDirPath))
          .then(resolveCancel)
          .catch(rejectCancel)
      })

      const filePaths = Object.keys(this.files)

      const {
        filesToDownload,
        filesToUpdatePermissions,
      }  = filePaths.reduce((acc, filePath) => {
        const {
          download,
          updatePermissions,
          isPack,
          packFiles,
          hash,
          size,
          executable,
        } = this.files[filePath]

        if (size === 0) {
          const emptyFilePath = path.join(this.location, filePath)
          try {
            fs.closeSync(fs.openSync(emptyFilePath, 'w'))
            // add to downloadedFiles to update the local hashes
            this.downloadedFiles[filePath] = this.files[filePath]
          } catch (error) {
            /* istanbul ignore next */
            logger.warn('download file: unable to create empty file', emptyFilePath, error)
          }
          return acc
        }

        const target = (isExecutable) => isExecutable ? { filePath, executable: true } : { filePath }

        if (!download) {
          if (updatePermissions) {
            acc.filesToUpdatePermissions.push(target(executable))
          }

          // if the file is not marked for download, add it to downloadedFiles to update the local hashes
          this.downloadedFiles[filePath] = this.files[filePath]
          return acc
        }

        if (hash in acc.filesToDownload) {
          acc.filesToDownload[hash].targets.push(target(executable))
        } else {
          acc.filesToDownload[hash] = { packFiles, isPack, size, targets: [target(executable)] }
        }
        return acc
      }, {
        filesToDownload: {},
        filesToUpdatePermissions: [],
      })

      this.setPermissions(filesToUpdatePermissions)

      const self = this

      const generatePromises = function* () {
        for (let hash in filesToDownload) {
          yield self.downloadFile(hash, filesToDownload[hash], progress)
            .then(() => {
              return new Promise((resolve) => {
                if (!isPaused) {
                  resolve()
                } else {
                  pendingResolveFunctions[hash] = () => {
                    delete pendingResolveFunctions[hash]
                    resolve()
                  }
                }
              })
            })
        }
      }

      const promiseIterator = generatePromises()
      const pool = PromisePool(promiseIterator, downloadConcurrency)

      pool.start()
        .then(() => fs.remove(this.tempDirPath))
        .then(() => resolve(this.downloadedFiles))
        .catch((error) => {
          fs.remove(this.tempDirPath)
          reject(error)
        })
    })
  }

  /**
   * @summary Create an url subpath
   * @param {String} gameUid - Game Uid
   * @param {String} hash - Hash
   * @returns {String} Subpath
   */
  toUrlSubpath(gameUid, hash) {
    return ['', gameUid, 'hashes', hash.substr(0, 2), hash].join('/')
  }

  /**
   * @summary Download a file
   * @param {String} hash - hash of the file
   * @param {Object} fileData - isPack, size and targets
   * @param {Function} progress - progress callback of the controllable promise
   * @returns {Promise} A Promise that resolve when the file is downloaded
   */
  downloadFile(hash, fileData, progress) {
    const {
      gameUid,
    } = this

    const {
      fs,
      fetch,
    } = this.dependencies

    const {
      isPack,
      targets,
    } = fileData


    const subpath = this.toUrlSubpath(gameUid, hash)
    const tempFilePath = path.join(this.tempDirPath, hash)

    fs.ensureDirSync(this.tempDirPath)

    const fetchPromise = fetch(subpath, tempFilePath, fileData, hash, !isPack)

    fetchPromise.onProgress(({chunkSize, downloadedSize}) => {
      this.chunkSize = chunkSize
      this.fileProgress[hash] = downloadedSize * targets.length
      this.notifyProgress(progress)
    })

    this.addRunningPromise(fetchPromise)

    return fetchPromise
      .then(() => {
        this.removeRunningPromise(fetchPromise)
        if (isPack) {
          // don't add the pack to downloadedFiles as it doesn't need to be in the localHashes
          return this.untarPack(tempFilePath, fileData)
        }

        targets.forEach(({ filePath }) => this.downloadedFiles[filePath] = this.files[filePath])
        return this.moveFiles(tempFilePath, targets)
      })
      .then(() => {
        if (!isPack) {
          this.setPermissions(targets)
        }
      })
      .catch((error) => {
        this.removeRunningPromise(fetchPromise)
        throw error
      })
  }

  /**
   * @summary Untar a file
   * @param {string} tempFilePath - the temporary file path of the pack
   * @param {Object} fileData - the data of the pack
   * @returns {Promise} A promise that resolve when the untar operation is finished
   */
  untarPack(tempFilePath, fileData) {
    const {
      ioHelper,
    } = this.dependencies

    const {
      packFiles,
    } = fileData

    return ioHelper.untar(tempFilePath, this.tempDirPath)
      .then(() => {
        const filesByHashes = this.getPackFilesByHashes(packFiles)
        return this.movePackFiles(filesByHashes)
          .then(() => {
            return this.setPackFilesPermissions(filesByHashes)
          })
      })
  }

  /**
   * @summary Get the pack's files by hashes
   * @param {Object} packFiles - the pack's files
   * @returns {Object} the pack's files by hashes
   */
  getPackFilesByHashes(packFiles) {
    const filesByHash = {}
    Object.keys(packFiles).forEach((fileName) => {
      const file = packFiles[fileName]
      if (!filesByHash.hasOwnProperty(file.hash)) {
        filesByHash[file.hash] = []
      }
      filesByHash[file.hash].push({
        filePath: fileName,
        executable: file.executable,
      })
    })

    return filesByHash
  }

  /**
   * @summary Move the files of a pack
   * @param {Object} packFilesByHashes - the pack's files by hashes
   * @return {Promise} A promise that resolve when all the files have been moved
   */
  movePackFiles(packFilesByHashes) {
    return promiseTry(() => {
      const movePromises = []

      Object.keys(packFilesByHashes).forEach((fileHash) => {
        const sourceFile = path.join(this.tempDirPath, fileHash)
        movePromises.push(
          this.moveFiles(sourceFile, packFilesByHashes[fileHash])
        )
      })

      return Promise.all(movePromises)
    })
  }

  /**
   * @summary Update the permissions of the pack's files
   * @param {Object} packFilesByHashes - the pack's files by hashes
   * @return {Promise} A promise that resolve when all the persmissions has been updated
   */
  setPackFilesPermissions(packFilesByHashes) {
    return promiseTry(() => {
      const permissionsPromises = []

      Object.keys(packFilesByHashes).forEach((fileHash) => {
        permissionsPromises.push(
          new Promise((resolve) => {
            this.setPermissions(packFilesByHashes[fileHash])
            resolve()
          })
        )
      })

      return Promise.all(permissionsPromises)
    })
  }

  /**
   * Move origin filePath to target filPathes
   * @param {String} origin - filePath
   * @param {Array} targets - Array of { filePath, executable }
   * @returns {Promise} A Promise that resolve the file has been moved
   */
  moveFiles(origin, targets) {
    const {
      fs,
    } = this.dependencies

    const [firstTarget, ...otherTargets] = targets

    return Promise.all(otherTargets.map((target) => {
      return fs.copy(origin, path.join(this.location, target.filePath))
    })).then(() => {
      return fs.move(origin, path.join(this.location, firstTarget.filePath), { overwrite: true })
    }).catch((error) => {
      if (this.params.isRunning) {
        throw error
      }
    })
  }

  /**
   * Set permission flags
   * @param {Array} targets - Array of { filePath, executable }
   * @returns {undefined} void
   */
  setPermissions(targets) {
    const {
      fs,
    } = this.dependencies

    targets.forEach(({ filePath, executable }) => {
      try {
        fs.chmodSync(path.join(this.location, filePath), parseInt(!!executable ? '744' : '644', 8))
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }
        logger.debug('Download fragment (setPermissions):', error)
      }
    })
  }

  /**
   * @summary Notify the progress
   * @param {Function} progress - progress function
   * @returns {undefined} void
   */
  notifyProgress(progress) {
    let downloadedSize = 0
    Object.keys(this.fileProgress).forEach((hash) => {
      downloadedSize += this.fileProgress[hash]
    })
    progress({
      chunkSize: this.chunkSize,
      downloadedSize,
    })
  }

  /**
   * @summary Add running promise
   * @param {ControllablePromise} promise - the promise to add
   * @returns {undefined} void
   */
  addRunningPromise(promise) {
    this.runningPromises.push(promise)
  }

  /**
   * @summary Remove a running promise
   * @param {ControllablePromise} promise - the promise to remove
   * @returns {undefined} void
   */
  removeRunningPromise(promise) {
    const index = this.runningPromises.indexOf(promise)
    if (index !== -1) {
      this.runningPromises.splice(index, 1)
    }
  }

  /**
   * @summary Pause the running promises
   * @returns {Promise} a promise that is resolved when all the running promises are paused
   */
  pauseRunningPromises() {
    return Promise.all(this.runningPromises.map(p => p.pause()))
  }

  /**
   * @summary Resume the running promises
   * @returns {Promise} a promise that is resolved when all the running promises are resumed
   */
  resumeRunningPromises() {
    return Promise.all(this.runningPromises.map(p => p.resume()))
  }

  /**
   * @summary Cancel the running promises
   * @returns {Promise} a promise that is resolved when all the running promises are canceld
   */
  cancelRunningPromises() {
    return Promise.all(this.runningPromises.map(p => p.cancel().catch((error) => {
      logger.debug('downloadFragment (cancelRunningPromises):', error.message)
    })))
  }

  /**
   * Handle all archives
   * @returns {Promise} resolve when all archives are handled
   */
  handleArchives({
    adapterManager = AdapterManager,
  } = {}) {
    return pMap(Object.keys(this.archives), this.handleArchive.bind(this), {
      concurrency: PMAP_CONCURRENCY,
    })
      .then((archiveDiff) => Promise.all(archiveDiff.map((a) => this.handleArchiveDiff(a, { adapterManager }))))
  }

  /**
   * Handle each archive in the diff
   * @param {Object} archive archive
   * @returns {Promise} resolved when the archive is handled
   */
  handleArchiveDiff(archive, {
    adapterManager = AdapterManager,
  } = {}) {
    const {
      fs,
    } = this.dependencies

    /* istanbul ignore next */
    if (archive.full) {
      return
    }

    delete this.files[archive.name]
    const adapter = adapterManager.getAdapter(archive.name)
    let newArchive = []
    const location = path.join(this.location, archive.name)
    return adapter.extract(location)
      .then((arch) => {
        for (const file of archive.meta.files) {
          newArchive.push({
            name: file,
            buffer: arch[file],
          })
        }

        const tmpDir = `.tmp-${Math.random().toString(36).substring(5)}-files`
        const archiveFilePath = path.join(this.location, tmpDir)
        fs.ensureDirSync(archiveFilePath)
        return pMap(archive.diff,
          this.downloadArchiveFile.bind(this, tmpDir, this.location), {
            concurrency: PMAP_CONCURRENCY,
          })
          .then((downloadedFiles) => {
            for (const file of downloadedFiles) {
              newArchive.find(f => f.name === file.name).buffer = file.buffer
            }
            return fs.remove(location)
          })
          .then(() => adapter.build(location, newArchive, archive.meta))
          .then(() => fs.remove(archiveFilePath))
      })
  }

  /**
   * Download a single file of an archive
   * @param {String} archiveFilePath archiveFilePath
   * @param {String} location location
   * @param {Object} archiveFile archiveFile
   * @returns {Promise<Object>} resolve when an archive is handled
   */
  downloadArchiveFile(archiveFilePath, location, archiveFile, {
    fs = this.dependencies.fs,
    dl = this.downloadFile.bind(this),
  } = {}) {
    const filePath = path.join(archiveFilePath, archiveFile.file.hash)
    return dl(archiveFile.file.hash, {
      size: archiveFile.file.size,
      targets: [{
        filePath,
      }],
    }, this.progress)
      .then(() => fs.readFile(path.join(location, filePath)))
      .then((buffer) => {
        return {
          name: archiveFile.file.name,
          hash: archiveFile.file.hash,
          buffer,
        }
      })
  }

  /**
   * Handle a single archive
   * @param {String} archiveName archiveName
   * @returns {Promise} resolve when an archive is handled
   */
  handleArchive(archiveName, {
    fetchJSON = this.repository.fetchJSON.bind(this.repository),
    xaccessSync = accessSync,
  } = {}) {
    const {
      gameUid,
    } = this

    return new Promise((resolve) => {
      const localFragment = this.params.localHashes[this.params.fragment]
      const remoteArchive = this.archives[archiveName]
      const localArchive = localFragment && localFragment.archives && localFragment.archives[archiveName]

      const metaFile = remoteArchive.files['.zaap.meta.json']
      delete remoteArchive.files['.zaap.meta.json']

      /* istanbul ignore next */
      if (!this.downloadedArchives[this.params.fragment]) {
        this.downloadedArchives[this.params.fragment] = {}
      }
      /* istanbul ignore next */
      if (!this.downloadedArchives[this.params.fragment][archiveName]) {
        this.downloadedArchives[this.params.fragment][archiveName] = {}
      }
      this.downloadedArchives[this.params.fragment][archiveName].files = remoteArchive.files

      const subpath = this.toUrlSubpath(gameUid, metaFile.hash)

      return fetchJSON(subpath)
        .then((meta) => {
          try {
            const location = path.join(this.location, archiveName)
            xaccessSync(location)
          } catch (err) {
            return resolve({
              full: true,
            })
          }

          if (!localArchive || !remoteArchive.files) {
            return resolve({
              full: true,
            })
          }

          const diff = []
          for (const file of Object.keys(localArchive.files)) {
            const remoteFile = remoteArchive.files[file]
            const localFile = localArchive.files[file]

            if (remoteFile && remoteFile.hash !== localFile.hash) {
              diff.push({
                file: Object.assign({ name: file }, remoteFile),
              })
            }
          }
          for (const file of Object.keys(remoteArchive.files)) {
            const remoteFile = remoteArchive.files[file]
            const localFile = localArchive.files[file]

            if (!localFile) {
              diff.push({
                file: Object.assign({ name: file }, remoteFile),
              })
            }
          }

          if (this.mustDownloadCompleteArchive(diff, remoteArchive)) {
            return resolve({
              full: true,
            })
          }

          return resolve({
            full: false,
            name: archiveName,
            diff,
            meta,
          })
        })
    })
  }

  /**
   * @param  {Object} diff diff
   * @param  {Object} remote remote
   * @returns {Boolean} if we have to download the complete archive
   */
  mustDownloadCompleteArchive(diff, remote) {
    const diffFiles = Object.values(diff)
    const remoteFiles = Object.values(remote.files)
    // const diffCount = diffFiles.length
    // const remoteCount = remoteFiles.length
    const diffSize = diffFiles.reduce((acc, d) => acc += d.file.size, 0)
    const remoteSize = remoteFiles.reduce((acc, d) => acc += d.size, 0)
    return diffSize > remoteSize * 0.7
  }
}

module.exports = UpdateActionDownloadFragment
