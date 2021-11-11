module.exports = function (haapi, sessionId, serverId, characterId, date) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_GAME_START_SESSION_WITH_API_KEY', {
    /* eslint-disable camelcase */
    session_id: sessionId,
    server_id: serverId,
    character_id: characterId,
    date,
    /* eslint-enable camelcase */
  })

  return http.get(url, {
    APIKEY: apiKey.key,
  }).then(response => response.body.toString())
}
