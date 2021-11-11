module.exports = function (haapi) {
  const {
    http,
    getAuth,
  } = haapi.modules

  const {
    apiKey,
  } = getAuth()

  const url = haapi.getUrl('ANKAMA_API_REFRESH_API_KEY')

  return http.post(url, {
    // eslint-disable-next-line camelcase
    refresh_token: apiKey.refreshToken,
    // eslint-disable-next-line camelcase
    long_life_token: true,
  }, {
    APIKEY: apiKey.key,
  }).then(function (response) {
    return {
      key: response.body.key,
      accountId: response.body.account_id,
      refreshToken: response.body.refresh_token,
    }
  })
}
