/**
 * Abstract disk info/space check
 *
 * @module zaap/disk
 */
const inject = require('instill')

inject(exports, {
  checkDiskSpace: require('check-disk-space'),
})

// Errors
const {
  errors,
  ZaapError,
} = require('./errors').register('DISK', {
  INVALID_PATH: 9001,
  UNABLE_TO_GET_DRIVE_INFO: 9002,
})

exports.errors = errors

/**
 * @summary Get the drive info of a HDD
 * @param {string} directoryPath - the path to check
 * @return {Promise} Promise object
 */
exports.getDriveInfo = function (directoryPath) {
  const {
    checkDiskSpace,
  } = this.modules

  const {
    INVALID_PATH,
    UNABLE_TO_GET_DRIVE_INFO,
  } = errors

  return checkDiskSpace(directoryPath)
    .catch(err => {
      if (err instanceof checkDiskSpace.InvalidPathError || err instanceof checkDiskSpace.NoMatchError) {
        throw new ZaapError(
          INVALID_PATH,
          err.message,
          'disk.error.invalidPath'
        )
      }

      throw new ZaapError(
        UNABLE_TO_GET_DRIVE_INFO,
        err.message,
        'disk.error.unableToGetDriveInfo'
      )
    })
}
