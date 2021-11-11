const Vuex = require('vuex')
const buildConfig = remote.require('lib/buildConfig')

const store = new Vuex.Store({
  strict: !buildConfig.isBuild,
  state: require('./state'),
  actions: require('./actions'),
  getters: require('./getters'),
  mutations: require('./mutations'),
})

// Sync local state with the main process registry
store.dispatch('syncZaapSettings')
store.dispatch('syncBuildConfig')
store.dispatch('syncWindow')
store.dispatch('syncAuth')
store.dispatch('syncUser')
store.dispatch('syncConnectivity')
store.dispatch('syncAutoUpdater')

module.exports = store
