/**
 * Check the release state and update it if there is error in it.
 * @param {Object} loadedData - data loaded from disk
 * @returns {undefined} void
 */
module.exports = function (loadedData) {
  if (!loadedData.location) {
    loadedData.version = false
    loadedData.isInstalling = false
    loadedData.isUpdating = false
    loadedData.isRepairing = false
    loadedData.installedFragments = []
    return
  }
}
