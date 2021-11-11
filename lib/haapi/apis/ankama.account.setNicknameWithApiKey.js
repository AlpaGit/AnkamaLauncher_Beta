module.exports = function (
  haapi,
  nickname,
  lang
) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_ACCOUNT_SET_NICKNAME_WITH_API_KEY')

  return http.post(url, {
    nickname,
    lang,
  }, {
    APIKEY: apiKey.key,
  })
}
