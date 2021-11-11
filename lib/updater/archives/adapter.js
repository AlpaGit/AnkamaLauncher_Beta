/**
 * @summary ArchivesAdapter
 */
class ArchivesAdapter {
  /**
   */
  constructor() {
    //
  }

  /**
   * @returns {rejected} reject error
   */
  extract() {
    return Promise.reject(new Error(`ArchivesAdapter: We can not use "extract" of the base class`))
  }

  /**
   * @returns {rejected} reject error
   */
  build() {
    return Promise.reject(new Error(`ArchivesAdapter: We can not use "build" of the base class`))
  }
}

module.exports = ArchivesAdapter
