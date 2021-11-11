module.exports = function (haapi, language, knownVersion = null) {
  const {
    http,
  } = haapi.modules

  const url = haapi.getUrl('ANKAMA_LEGALS_TOU', {
    game: 1,
    lang: language,
    knowVersion: knownVersion,
  })

  return http.get(url)
    .then(function (response) {
      if (response.status === 204) {
        return null
      }

      let sections = []

      response.body.texts.forEach((section) => {
        sections.push({
          title: section.title,
          content: section.content,
        })
      })

      return {
        currentVersion: parseInt(response.body.current_version),
        sections,
      }
    })
}
