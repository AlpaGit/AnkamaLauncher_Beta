/**
 * Patch console log to electron, provide logger
 */
const logger = {
  _remote: false,
  realConsole: window.console,
  log: function (...args) {
    const console = this.realConsole
    const call = args.shift()
    if (console[call]) {
      console[call].apply(console, args)
    } else {
      console.log.apply(console, args)
    }
    args.unshift(this._label)
    const remote = logger._remote
    remote[call].apply(remote, args.map(function (arg) {
      if (arg instanceof Error) {
        return arg.stack
      }
      return arg
    }))
  },
  setup: function () {
    try {
      const remote = require('electron').remote
      const appPath = remote.require('lib/app').getAppPath()
      const path = window.__dirname.substring(appPath.length + 1)
      logger._remote = remote.require('lib/logger')
      logger._label = `[browser::${path}]`
      const levels = ['error', 'warn', 'notice', 'info', 'debug']
      levels.forEach(function (name) {
        logger[name] = logger.log.bind(logger, name)
      })
      window.onerror = function (message, url, linenumber, col, error) {
        logger._remote.error(logger._label, error.stack)
      }
      window.realConsole = logger.realConsole
      window.console = {
        log: logger.debug.bind(logger),
        warn: logger.warn.bind(logger),
        error: logger.error.bind(logger),
      }
    } catch (error) {
      console.warn('Logger is disabled')
    }
  },
}
logger.setup()
