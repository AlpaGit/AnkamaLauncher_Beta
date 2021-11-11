module.exports = function (haapi, gameId) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_ACCOUNT_CREATE_TOKEN', {
    game: gameId,
  })

  return http.get(url, {
    APIKEY: apiKey.key,
  }).then(function (response) {
    return response.body.token
  })
}
