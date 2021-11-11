const remoteCommunication = require('./remoteCommunication')

/**
 * This module manages the News
 *
 * @module zaap/newsIpcManager
 */
class NewsIpcManager {
  /**
   * NewsIpcManager Constructor
   * @param {*} param0 Injected dependencies
   */
  constructor({
    ipcMain = require('electron').ipcMain,
    logger = require('./logger'),
    news = require('./news'),
  } = {}) {
    this.ipcMain = ipcMain
    this.logger = logger
    this.news = news

    this.refreshAllNewsBinded = this.refreshAllNews.bind(this)

    this.ipcMain.on(
      remoteCommunication.CHANNELS.NEWS_REFRESH,
      this.refreshAllNewsBinded
    )
  }

  /**
   * @summary ipcMain event handler for NEWS_REFRESHED
   * @param {Object} event - event
   * @param {Number} page - page
   * @param {Number} count - count
   * @returns {undefined} void
   */
  refreshAllNews(event, page = 1, count = 20) {
    return this.news.get('ALL', page, count)
      .then((news) => {
        event.sender.send(remoteCommunication.CHANNELS.NEWS_REFRESHED, news)
      })
      .catch((error) => {
        /* istanbul ignore next */
        this.logger.error('news: cannot refresh all news', error)
      })
  }

  /**
   * Destructor
   * @returns {undefined}
   */
  destroy() {
    this.ipcMain.removeListener(
      remoteCommunication.CHANNELS.NEWS_REFRESH,
      this.refreshAllNewsBinded
    )
  }
}

module.exports = NewsIpcManager
