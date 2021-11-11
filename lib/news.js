
const inject = require('instill')

inject(exports, {
  haapi: require('./haapi'),
  settings: require('./settings'),
})

const CACHE_LIFETIME_IN_MS = 5 * 60 * 1000

exports.cache = {}

/**
 * @summary Get the news on haapi
 * @param {String} site - the CMS site
 * @param {Number} page - page number
 * @param {Number} count - number of news to get
 * @returns {Promise} Promise object
 */
exports.get = function (site, page = 1, count = 3) {
  const {
    haapi,
    settings,
  } = this.modules

  const language = settings.get(settings.KEYS.LANGUAGE)
  const cacheKey = [site, page, count, language].join('/')

  const cachedSite = this.cache[cacheKey]
  if (cachedSite && cachedSite.date + CACHE_LIFETIME_IN_MS > Date.now()) {
    if (!cachedSite.news) {
      return cachedSite.promise
    }
    return Promise.resolve(cachedSite.news)
  }

  const haapiPromise = haapi.get(
    'ankama.cms.items.get',
    language,
    'NEWS',
    site,
    page,
    count
  )

  this.cache[cacheKey] = {
    date: Date.now(),
    promise: haapiPromise,
  }

  haapiPromise
    .then((news) => {
      const convertedNews = news.map((n) => {
        n.type = n.imageUrl ? 'IMG' : 'TXT'
        return n
      })
      this.cache[cacheKey].news = convertedNews
      return convertedNews
    })
    .catch(() => {
      delete this.cache[cacheKey]
    })

  return haapiPromise
}
