module.exports = function (haapi) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_ACCOUNT_ORIGIN_WITH_API_KEY')

  return http.get(url, {
    APIKEY: apiKey.key,
  }).then((response) => response.body)
}
