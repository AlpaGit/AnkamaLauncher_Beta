module.exports = function (haapi) {
  const {
    http,
    getAuth,
  } = haapi.modules

  const {
    apiKey,
  } = getAuth()

  const url = haapi.getUrl('ANKAMA_ACCOUNT_STATUS')

  return http.get(url, {
    APIKEY: apiKey.key,
  }).then(response => {
    const status = response.body.reduce((acc, cur) => {
      acc[cur.id] = cur.value
      return acc
    }, {})

    return {
      acceptedTermsVersion: parseInt(status.CGU),
    }
  })
}
