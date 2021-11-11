module.exports = function (haapi, login, password) {
  const {
    http,
  } = haapi.modules

  const url = haapi.getUrl('ANKAMA_API_CREATE_API_KEY')

  return http.post(url, {
    login,
    password,
    // eslint-disable-next-line camelcase
    long_life_token: true,
  }).then(function (response) {
    return {
      key: response.body.key,
      accountId: response.body.account_id,
      refreshToken: response.body.refresh_token,
    }
  })
}
