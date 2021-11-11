
const inject = require('instill')

inject(exports, {
  uuidv4: require('uuid/v4'),
  settings: require('./settings'),
})


/**
 * @summary Indicates if the device uid has already been stored in the settings
 * @returns {boolean} True if the device uid has already been stored in the settings
 */
exports.hasStoredUid = function () {
  const {
    settings,
  } = this.modules

  const {
    DEVICE_UID,
  } = settings.KEYS

  return !!settings.get(DEVICE_UID)
}


/**
 * @summary Create a device uid, or get it from the settings if already created.
 * @returns {string} The device uid
 */
exports.getUid = function () {
  const {
    uuidv4,
    settings,
  } = this.modules

  const {
    DEVICE_UID,
  } = settings.KEYS

  let deviceUid = settings.get(DEVICE_UID)

  if (!deviceUid) {
    deviceUid = uuidv4()
    settings.set(DEVICE_UID, deviceUid)
  }

  return deviceUid
}
