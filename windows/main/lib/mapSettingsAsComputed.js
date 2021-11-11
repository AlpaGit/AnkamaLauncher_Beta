exports = module.exports = function (mapping) {
  return Object.keys(mapping).reduce((computedProperties, property) => {
    const settingsKey = mapping[property]
    computedProperties[property] = {
      get() {
        return this.$store.state.settings[settingsKey]
      },
      set(value) {
        this.$store.dispatch('setZaapSettings', { settingsKey, value })
      },
    }

    return computedProperties
  }, {})
}
