module.exports = function (haapi, gameId) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_ACCOUNT_SIGN_ON_WITH_API_KEY')

  return http.post(url, {
    game: gameId,
  }, {
    APIKEY: apiKey.key,
  }).then((response) => {
    const {
      id,
      type,
      login,
      nickname,
      security,
      added_date: addedDate,
      locked,
    } = response.body.account

    return {
      id: response.body.id.toString(),
      account: {
        id,
        type,
        login,
        nickname,
        security,
        addedDate,
        locked,
      },
    }
  })
}
