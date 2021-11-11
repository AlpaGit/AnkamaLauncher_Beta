const DiffHelper = require('./diffHelper')

module.exports = {
  computeDiff: function (fragments, localHashes, remoteHashes) {
    return (new DiffHelper(fragments, localHashes, remoteHashes)).createPromise()
  },
}
