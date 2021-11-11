module.exports = (iterator, concurrency = 1) => {
  if (!(typeof concurrency === 'number' && concurrency >= 1)) {
    throw new TypeError('Expected concurrency to be a number >= 1')
  }

  const start = () => new Promise((resolve, reject) => {
    const ret = []
    let isRejected = false
    let iterableDone = false
    let resolvingCount = 0
    let currentIdx = 0

    const next = () => {
      if (isRejected) {
        return
      }

      const nextItem = iterator.next()
      const i = currentIdx
      currentIdx += 1

      if (nextItem.done) {
        iterableDone = true

        if (resolvingCount === 0) {
          resolve(ret)
        }

        return
      }

      resolvingCount += 1

      nextItem.value
        .then((value) => {
          ret[i] = value
          resolvingCount -= 1
          next()
        })
        .catch((error) => {
          isRejected = true
          reject(error)
        })
    }

    for (let i = 0; i < concurrency; i += 1) {
      next()

      if (iterableDone) {
        break
      }
    }
  })

  return { start }
}
