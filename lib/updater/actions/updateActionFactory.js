const appSettings = require('../../settings')
const buildConfig = require('../../buildConfig')
const checkConfiguration = require('../../games/checkConfiguration')
const cryptoHelper = require('../../cryptoHelper')
const deleteEmpty = require('delete-empty')
const disk = require('../../disk')
const fetch = require('../../fetch')
const fs = require('fs-extra')
const logger = require('../../logger')
const path = require('path')
const pathHelper = require('../../pathHelper')
const scriptSpawner = require('../../scriptSpawner')
const ioHelper = require('../../ioHelper')
const updateHelper = require('../helpers/updateHelper')

const DOWNLOAD_CONCURRENCY = 6

// actions
const ACTIONS = []
fs.readdirSync(__dirname).forEach((fileName) => {
  const name = fileName.substring(fileName, fileName.length - 3)
  const filePath = path.join(__dirname, name)
  const action = require(filePath)
  if (action.name && action.name !== 'UpdateAction') {
    ACTIONS[action.name] = action
  }
})

const dependencies = {
  appSettings,
  buildConfig,
  checkConfiguration,
  cryptoHelper,
  deleteEmpty,
  disk,
  downloadConcurrency: DOWNLOAD_CONCURRENCY,
  fetch,
  fs,
  ioHelper,
  logger,
  pathHelper,
  platform: process.platform,
  scriptSpawner,
  updateHelper,
}

/**
 * @summary UpdateActionFactory
 */
class UpdateActionFactory {
  /**
   * @summary Returns an instance of action
   * @param {Symbol} type - the type of the action
   * @param {repository.Repository} repository - The repository to get the update from
   * @param {String} gameUid - gameUid of the game's release to update
   * @param {String} releaseName - name of the release to update
   * @param {String} version - version of the release to update to
   * @param {Configuration} configuration - configuration of the release to update
   * @param {String} location - where to execute the update
   * @param {Object} params - additional parameters
   * @returns {UpdateAction} the created action
   */
  static get(type, repository, gameUid, releaseName, version, configuration, location, params) {
    try {
      return new ACTIONS['UpdateAction' + type](
        repository,
        gameUid,
        releaseName,
        version,
        configuration,
        location,
        dependencies,
        params)
    } catch (error) {
      throw new Error(`UpdateActionFactory: unable to instantiate action. ${error}`)
    }
  }

  /**
   * @summary Returns the dependencies used on action instantiation
   * @returns {Object} the dependencies used on action instantiation
   */
  static get dependencies() {
    return dependencies
  }
}

module.exports = UpdateActionFactory
