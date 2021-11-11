module.exports = function (
  haapi,
  sessionId,
  connectionType,
  clientType,
  os,
  device,
  partner,
  deviceUid
) {
  const {
    http,
  } = haapi.modules

  const {
    apiKey,
  } = require('../../auth')

  const url = haapi.getUrl('ANKAMA_ACCOUNT_SEND_DEVICE_INFOS')

  return http.post(url, {
    /* eslint-disable camelcase */
    session_id: sessionId,
    connection_type: connectionType,
    client_type: clientType,
    os,
    device,
    partner,
    device_uid: deviceUid,
    /* eslint-enable camelcase */
  }, {
    APIKEY: apiKey.key,
  })
}
