module.exports = function (haapi, gameId, sessionId, events) {
  const {
    http,
  } = haapi.modules

  const url = haapi.getUrl('ANKAMA_GAME_SEND_EVENTS')

  return http.post(url, {
    /* eslint-disable camelcase */
    game: gameId,
    session_id: sessionId,
    events,
    /* eslint-enable camelcase */
  })
}
