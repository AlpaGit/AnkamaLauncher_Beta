const appSettings = require('../settings')
const scriptSpawner = require('../scriptSpawner')

const defaultDependencies = {
  appSettings,
  scriptSpawner,
}

// Errors
const {
  errors,
  ZaapError,
} = require('../errors').register('CHECK_CONFIGURATION', {
  BAD_CONFIGURATION: 13000,
})

/**
 * @summary Check the configuration needed for a release
 * @param {String} location - the location from where the check should be done
 * @param {Configuration} configuration - the configuration of the release
 * @returns {Promise} A promise that resolve if configuration is compatible
 */
module.exports = (location, configuration, {appSettings, scriptSpawner} = defaultDependencies) => {
  const {
    BAD_CONFIGURATION,
  } = errors

  return new Promise((resolve, reject) => {
    if (!configuration.checkConfiguration) {
      resolve()
    } else {
      const proc = scriptSpawner.spawn(location, configuration.checkConfiguration.script)
      proc.on('exit', (code) => {
        if (code !== 0) {
          const language = appSettings.get(appSettings.KEYS.LANGUAGE)
          let errorMessage = 'Unknown error'

          try {
            const message = configuration.checkConfiguration.results[code].message
            if (message[language]) {
              errorMessage = message[language]
            } else if (message.en) {
              // fallback if translation is not found
              errorMessage = message.en
            }
          } catch (error) {}

          return reject(
            new ZaapError(
              BAD_CONFIGURATION,
              `${errorMessage} (${code})`
            ))
        }

        resolve()
      })
    }
  })
}
