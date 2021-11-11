module.exports = function (haapi, language, templateKey, site, page = 1, count = 3) {
  const {
    http,
  } = haapi.modules

  const url = haapi.getUrl('ANKAMA_CMS_ITEMS_GET', {
    // eslint-disable-next-line camelcase
    template_key: templateKey,
    site: site,
    lang: language,
    page,
    count,
  })

  return http.get(url)
    .then(function (response) {
      return response.body.map((news) => {
        return {
          id: news.id,
          title: news.name,
          // eslint-disable-next-line camelcase
          imageUrl: news.image_url,
          // eslint-disable-next-line camelcase
          url: news.canonical_url,
        }
      })
    })
}
