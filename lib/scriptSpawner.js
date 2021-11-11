/**
 * Allow us to run a script depending of the OS
 *
 * @module zaap/scriptSpawner
 */
const inject = require('instill')
const path = require('path')
const ipcMain = require('electron').ipcMain

inject(exports, {
  platform: process.platform,
  cp: require('child_process'),
  fs: require('fs'),
  remoteCommunication: require('./remoteCommunication'),
})

// Errors
const {
  errors,
  ZaapError,
} = require('./errors').register('SCRIPTSPAWNER', {
  SCRIPT_NOT_FOUND: 8000,
})

exports.errors = errors

let nextId = 1

/**
 * @summary Start the ipc communication between the main and renderer process
 * @returns {undefined} void
 */
exports.setup = function () {
  const {
    remoteCommunication,
  } = this.modules

  ipcMain.on(remoteCommunication.CHANNELS.SPAWN_SCRIPT, (event, {
    location,
    path,
    args,
    injectedEnv,
  }) => {
    const id = nextId
    event.returnValue = id
    nextId += 1

    try {
      const proc = this.spawn(location, path, args, injectedEnv)
      proc.on('exit', (code) => {
        event.sender.send(remoteCommunication.CHANNELS.SPAWN_SCRIPT_RESULT, id, code)
      })
    } catch (error) {
      console.error('scriptSpawner: spawn error:', error)
      event.sender.send(remoteCommunication.CHANNELS.SPAWN_SCRIPT_RESULT, id, error)
    }
  })
}

/**
 * @summary Spawn script depending on the OS
 * @param {String} location The path to the folder from where the script will be run
 * @param {String} scriptName The script name without extension
 * @param {Array} args Argument list given to the spawned process
 * @param {Object} injectedEnv Additional environment variables (added to process.env)
 * @returns {ChildProcess} The spawned process
 */
exports.spawn = function (location, scriptName, args = [], injectedEnv = {}) {
  const {
    cp,
    fs,
    platform,
  } = this.modules

  const {
    SCRIPT_NOT_FOUND,
  } = errors

  let prefix = ''
  if (platform !== 'win32') {
    prefix = './'
  }

  const scriptPath = `${prefix}${scriptName}.${this.getPlatformScriptExtension()}`

  if (!fs.existsSync(path.join(location, scriptPath))) {
    throw new ZaapError(SCRIPT_NOT_FOUND, 'Unable to spawn script. ' + scriptPath + ' doesn\'t exists.')
  }

  const env = Object.assign({}, process.env, injectedEnv)
  return cp.spawn(scriptPath, args, {
    cwd: location,
    env,
  })
}

/**
 * @summary Returns the extension depending on the OS
 * @returns {String} The file extension ps1 or sh
 */
exports.getPlatformScriptExtension = function () {
  const {
    platform,
  } = this.modules

  if (platform === 'win32') {
    return 'bat'
  }

  return 'sh'
}
