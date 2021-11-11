module.exports = function (haapi, version) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_LEGALS_SET_TOU_VERSION')

  return http.post(url, {
    iVersion: version,
  }, {
    APIKEY: apiKey.key,
  })
}
