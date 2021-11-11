/* global Vue */
/**
 * @summary Helper for creating Vue.js components.
 * @param {Object} ctx - `this` context
 * @param {String} name - Name of the component
 * @param {Object} cfg - Vue.js component configuration.
 * @returns {undefined} void
 */
window.VueComponent = function (ctx, name, cfg = {}) {
  const path = require('electron').remote.require('path')
  const localDocument = ctx.document.currentScript.ownerDocument
  const data = cfg.data

  cfg = Object.assign(cfg, {
    name: name,
    componentName: name,
    data: function () {
      let ret = {}
      if (typeof data === 'function') {
        ret = data.call(this)
      } else if (data) {
        ret = data
      }

      const componentPath = path.dirname(localDocument.URL).replace(/file:\/\/(\/[A-Z]:)?(\/windows\/[a-z]+)?/, '.')

      ret = Object.assign(ret, {
        component: {
          path: componentPath,
        },
      })

      const styleTag = localDocument.querySelector('style')
      if (styleTag) {
        ret.component.styleTag = styleTag
      }

      return ret
    },
  })

  if (!cfg.render) {
    cfg.template = localDocument.querySelector('template')
  }

  Vue.component(name, cfg)
}
