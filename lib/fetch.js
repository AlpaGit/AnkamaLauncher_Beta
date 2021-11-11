const ControlablePromise = require('./controllablePromise')
const logger = require('./logger')

const TIMEOUT = 2000
const MAX_RETRY = 5

const RETRY_ERROR_CODES = [
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'ENOENT',
  'ENOTFOUND',
  'ECONNABORTED',
  'EAI_AGAIN',
]

module.exports = function (subpath, filepath, fileData, hash, checkHash = true, {
  electronFetch = require('electron-fetch'),
  cryptoHelper = require('./cryptoHelper'),
  fs = require('fs'),
  registry = require('./games/registry'),
  timeout = TIMEOUT,
  maxRetry = MAX_RETRY,
} = {}) {
  const {
    server,
    host,
    cachedServers,
  } = registry.repository

  const {
    targets,
    size: expectedSize,
  } = fileData

  const cp = new ControlablePromise((resolve, reject, progress, onPause, onResume, onCancel) => {
    const url = cachedServers[Math.floor((Math.random() * cachedServers.length))] + subpath

    function isRetryError(error) {
      return error.type === 'request-timeout' ||
        (error instanceof electronFetch.FetchError &&
         error.type === 'system' &&
         RETRY_ERROR_CODES.includes(error.code))
    }

    logger.debug(`fetch:`, {
      hash,
      size: expectedSize,
      targets,
      repository: server,
      host,
      cached: cachedServers,
      url,
    })

    const headers = { host }

    let rs = null
    let ws = null
    let size = 0
    let isCancellable = true

    let shouldResume = fs.existsSync(filepath)

    const cleanAndRetry = () => {
      delete headers.Range
      try {
        fs.unlinkSync(filepath)
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn(`fetch: cannot remove file ${filepath}`, error)
          return reject(error)
        }
      }
      startElectronFetch()
    }

    const onResponse = (res) => {
      if (cp.isSettled || cp.isPaused || rs) {
        return
      }

      if (shouldResume && fs.existsSync(filepath) && fs.statSync(filepath).size === expectedSize) {
        return resolve()
      }

      if (res.status === 416) {
        logger.warn(`fetch: error 416: range ${headers.Range} unsatisfiable for ${filepath} (${expectedSize} bytes)`)
        return cleanAndRetry()
      }

      if (res.status !== 206 && res.status !== 200) {
        return reject(new Error(`Code: ${res.status}`))
      }

      if (shouldResume && res.headers.get('accept-ranges') !== 'bytes') {
        return reject(new Error('Partial content not supported'))
      }

      rs = res.body

      ws = fs.createWriteStream(filepath, {
        flags: shouldResume ? 'a' : 'w',
      })

      rs.on('data', (chunk) => {
        size += chunk.length
        progress({
          chunkSize: chunk.length,
          downloadedSize: size,
        })
      })

      ws.once('finish', () => {
        if (fs.existsSync(filepath) && fs.statSync(filepath).size === expectedSize) {
          isCancellable = false
          if (!checkHash) {
            return resolve()
          }

          cryptoHelper.getFileHash(filepath)
            .then((computedHash) => {
              if (computedHash === hash) {
                return resolve()
              }
              logger.warn(`fetch: computed hash differ from expected hash ${hash}`)
              cleanAndRetry()
            })
            .catch(reject)
        }
      })

      rs.once('error', (error) => {
        logger.error('fetch', error)
        ws.end(() => {
          reject(error)
        })
      })

      ws.once('error', (error) => {
        logger.error('fetch', error)
        rs.end()
        reject(error)
      })

      rs.pipe(ws)
    }

    const startElectronFetch = (retryCount = 0) => {
      shouldResume = fs.existsSync(filepath)
      if (shouldResume) {
        size = fs.statSync(filepath).size
        if (!!size) {
          Object.assign(headers, { Range: `bytes=${size}-` })
        } else {
          shouldResume = false
        }
      }

      electronFetch(url, {
        headers,
        useElectronNet: false,
        timeout: timeout * (retryCount + 1),
      }).then(onResponse)
        .catch((error) => {
          const shouldRetry = retryCount < maxRetry && isRetryError(error)

          if (shouldRetry) {
            /* istanbul ignore next */
            startElectronFetch(retryCount + 1)
          } else {
            reject(error)
          }
        })
    }

    startElectronFetch()

    onPause((resolvePause, rejectPause) => {
      try {
        if (rs) {
          rs.unpipe(ws)
          rs.end()
          rs = null
        }
        if (ws) {
          ws.end()
        }
        resolvePause()
      } catch (error) {
        rejectPause(error)
      }
    })

    onResume((resolveResume, rejectResume) => {
      try {
        shouldResume = true
        startElectronFetch()
        resolveResume()
      } catch (error) {
        rejectResume(error)
      }
    })

    onCancel((resolveCancel, rejectCancel) => {
      if (!isCancellable) {
        rejectCancel(new Error(`${hash} is no longer cancellable`))
        return
      }

      try {
        if (rs) {
          rs.unpipe()
          rs.end()
          rs = null
        }

        new Promise(resolve => !!ws ? ws.end(resolve) : resolve())
          .then(() => {
            if (fs.existsSync(filepath)) {
              fs.unlinkSync(filepath)
            }
            resolveCancel()
          })
          .catch(rejectCancel)
      } catch (error) {
        rejectCancel(error)
      }
    })
  })

  return cp
}

module.exports.TIMEOUT = TIMEOUT
module.exports.RETRY_ERROR_CODES = RETRY_ERROR_CODES
