module.exports = function (haapi, sessionId, subscriber, closeAccountSession) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_GAME_END_SESSION_WITH_API_KEY', {
    /* eslint-disable camelcase */
    session_id: sessionId,
    subscriber,
    close_account_session: closeAccountSession,
    /* eslint-enable camelcase */
  })

  return http.get(url, {
    APIKEY: apiKey.key,
  })
}
