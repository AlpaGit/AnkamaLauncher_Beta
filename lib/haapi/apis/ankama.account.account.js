module.exports = function (haapi) {
  const {
    http,
    getAuth,
  } = haapi.modules

  const {
    apiKey,
  } = getAuth()

  const url = haapi.getUrl('ANKAMA_ACCOUNT_ACCOUNT')

  return http.get(url, {
    APIKEY: apiKey.key,
  }).then(function (response) {
    return {
      id: response.body.id,
      nickname: response.body.nickname,
    }
  })
}
