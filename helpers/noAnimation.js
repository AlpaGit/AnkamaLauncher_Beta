const electron = require('electron')
const remote = electron.remote
const path = remote.require('path')

function insertCSSImport(cssFile, el) {
  const noAnimStyle = document.createElement('style')
  const cssPath = path.join(__dirname, cssFile).replace(/\\/g, '\\\\')
  const content = `@import url("${cssPath}");`
  const node = document.createTextNode(content)
  noAnimStyle.appendChild(node)

  el.appendChild(noAnimStyle)
}

exports.disableAnimations = function (el) {
  insertCSSImport('../noanimations.css', el)
}
