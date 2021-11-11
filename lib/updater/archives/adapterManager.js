const { extname } = require('path')

const ArchivesAdapter = require('./adapter')
const D2PAdapter = require('./d2pAdapter')

const ADAPTERS = {
  '.d2p': D2PAdapter,
}

/**
 * @summary AdapterManager
 */
class AdapterManager {
  /**
   * Instanciate the right adapter for the given file
   * @param  {String} filename filename
   * @returns {ArchivesAdapter|D2PAdapter} Adapter
   */
  static getAdapter(filename) {
    const ext = extname(filename)

    const adapter = ADAPTERS[ext]

    if (!adapter) {
      return new ArchivesAdapter()
    }

    return new adapter()
  }
}

module.exports = AdapterManager
