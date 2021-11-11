/**
 * @summary Start a promise chain
 * @param {Function} callback - If the callback throws an error, the returned Promise will be rejected with that error
 * @returns {Promise} Promise resolved with the value of the callback
 */
exports.promiseTry = (callback) => new Promise((resolve) => {
  resolve(callback())
})
