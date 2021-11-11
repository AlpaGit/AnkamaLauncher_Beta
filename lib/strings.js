exports.lowercaseFirstLetter = function (string) {
  return string.charAt(0).toLowerCase() + string.slice(1)
}

exports.objectKeysToLowerCase = function (input) {
  if (typeof input !== 'object') {
    return input
  }
  if (Array.isArray(input)) {
    return input.map(this.objectKeysToLowerCase)
  }
  return Object.keys(input).reduce((newObj, key) => {
    const val = input[key]
    const newVal = (typeof val === 'object') ? this.objectKeysToLowerCase(val) : val
    newObj[this.lowercaseFirstLetter(key)] = newVal
    return newObj
  }, {})
}
