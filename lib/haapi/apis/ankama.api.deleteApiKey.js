module.exports = function (haapi) {
  const {
    http,
    getAuth,
  } = haapi.modules

  const {
    apiKey,
  } = getAuth()

  const url = haapi.getUrl('ANKAMA_API_DELETE_API_KEY')

  return http.get(url, {
    APIKEY: apiKey.key,
  }).then(() => {
    return true
  })
}
