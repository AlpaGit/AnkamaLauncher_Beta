
/**
 * Migrate the data loaded from disk to the current release version
 * @param {Object} loadedData - data loaded from disk
 * @returns {undefined} void
 */
module.exports = function (loadedData) {
  if (!loadedData.gameUid && loadedData.gameName) {
    const namesToUid = {
      Dofus: 'dofus',
      'Dofus Cube': 'dofus-cube',
      Krosmaga: 'krosmaga',
      'Krosmaster Arena': 'krosmaster-arena',
      Wakfu: 'wakfu',
    }
    loadedData.gameUid = namesToUid[loadedData.gameName] || loadedData.gameName
    loadedData.gameName = Object.keys(namesToUid).find(key => namesToUid[key] === loadedData.gameUid)
  }

  if (loadedData.isRepairing === true) {
    loadedData.isRepairing = loadedData.repositoryVersion
  }
}
