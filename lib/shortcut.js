/**
 * Abstracts shortcuts management
 *
 * @module zaap/remoteCommunication
 */
const path = require('path')
const os = require('os')
const inject = require('instill')

inject(exports, {
  fs: require('fs'),
  windowsShortcuts: require('windows-shortcuts'),
})

const getDesktopPath = () => {
  return path.join(os.homedir(), 'Desktop')
}

const getDesktopShortcutPath = (shortcutName) => {
  const desktopPath = getDesktopPath()
  return path.join(desktopPath, shortcutName + '.lnk')
}

exports.create = function (shortcutName, target, args, icon) {
  const {
    windowsShortcuts,
  } = this.modules

  const desktopShortcutPath = getDesktopShortcutPath(shortcutName)

  const options = {
    target,
    args,
    icon,
    desc: shortcutName,
  }

  windowsShortcuts.create(desktopShortcutPath, options, (error) => {
    if (error) {
      throw error
    }
  })
}

exports.delete = function (shortcutName) {
  const {
    fs,
  } = this.modules

  const desktopShortcutPath = getDesktopShortcutPath(shortcutName)

  fs.unlinkSync(desktopShortcutPath)
}
