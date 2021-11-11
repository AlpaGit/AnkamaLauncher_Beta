const fs = require('fs')
const path = require('path')
const VueI18n = require('vue-i18n')

const settings = remote.require('lib/settings')

Vue.use(VueI18n)

const langsPath = path.join(__dirname, '..', 'langs')
const langFiles = fs.readdirSync(langsPath)

let messages = {}
langFiles.forEach((filePath) => {
  const language = filePath.split('.')[0]

  try {
    messages[language] = require(path.join(langsPath, filePath))
  } catch (error) {
    logger.error('Unreadable language file', error)
  }
})

const fallbackLocale = settings.defaultLanguage
const locale = settings.get(settings.KEYS.LANGUAGE)

module.exports = new VueI18n({
  fallbackLocale,
  locale,
  messages,
})
