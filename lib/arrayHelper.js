const deepEqual = require('deep-equal')

exports.equalsIgnoreOrder = (array1, array2) => {
  if (!array1 || !array2) {
    return false
  }

  if (array1.length !== array2.length) {
    return false
  }

  for (let i = 0; i < array1.length; i += 1) {
    const element1 = array1[i]
    if (!array2.find((element2) => {
      return deepEqual(element1, element2)
    })) {
      return false
    }
  }

  return true
}
