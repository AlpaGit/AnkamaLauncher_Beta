const inject = require('instill')
const promisify = require('es6-promisify').promisify

const ENCODING = 'utf8'
const ALGORITHM = 'aes-128-cbc'
const SEPARATOR = '|' // this character separate the initialisation vector and the encrypted data

/* istanbul ignore next */
inject(exports, {
  crypto: require('crypto'),
  fs: require('fs'),
  logger: require('./logger'),
  os: require('os'),
})

/**
 * @summary Get UUID
 * @returns {string} UUID
 */
exports.getUUID = function () {
  const {
    os,
  } = this.modules

  return [
    os.platform(),
    os.arch(),
    os.totalmem(),
    os.cpus().length,
    os.cpus()[0].model,
  ].join()
}

/**
 * @summary Create an hash from a string
 * @param {string} string - the string
 * @returns {string} the generated hash
 */
exports.createHashFromString = function (string) {
  const {
    crypto,
  } = this.modules

  const hash = crypto.createHash('md5')
  hash.update(string)
  return hash.digest()
}

/**
 * @summary Encrypt data
 * @param {*} data - the data to encrypt
 * @param {string | Buffer | TypedArray | DataView} key - the encryption key
 * @returns {string} The encrypted data
 */
exports.encrypt = function (data, key) {
  const {
    crypto,
  } = this.modules

  const hash = this.createHashFromString(key)
  const initializationVector = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, hash, initializationVector)
  const dataBuffer = new Buffer(JSON.stringify(data), ENCODING)
  const encryptedBuffer = Buffer.concat([cipher.update(dataBuffer), cipher.final()])
  const encryptedData = initializationVector.toString('hex') + SEPARATOR + encryptedBuffer.toString('hex')
  return encryptedData
}

/**
 * @summary Encrypt data and save it to a file
 * @param {string} filepath - the path of the file where the encrypted date will be saved
 * @param {*} data - the data to encrypt
 * @param {string | Buffer | TypedArray | DataView} key - the encryption key
 * @returns {Promise<string>} The encrypted data
 */
exports.encryptToFile = function (filepath, data, key) {
  const {
    fs,
    logger,
  } = this.modules

  const encryptedData = this.encrypt(data, key)

  const writeFile = promisify(fs.writeFile)
  return writeFile(filepath, encryptedData, ENCODING)
    .then(() => {
      return encryptedData
    })
    .catch((error) => {
      logger.error('cryptoHelper: cannot encrypt to file', error)
      throw error
    })
}

/**
 * @summary Encrypt data and save it to a file
 * @param {string} filepath - the path of the file where the encrypted date will be saved
 * @param {*} data - the data to encrypt
 * @returns {Promise<string>} The encrypted data
 */
exports.encryptToFileWithUUID = function (filepath, data) {
  const uuid = this.getUUID()
  return this.encryptToFile(filepath, data, uuid)
}

/**
 * @summary Decrypt data
 * @param {string} data - the data to decrypt
 * @param {string | Buffer | TypedArray | DataView} key - the encryption key
 * @returns {*} The decrypted data
 */
exports.decrypt = function (data, key) {
  const {
    crypto,
  } = this.modules

  const splittedData = data.split(SEPARATOR)
  const initializationVector = new Buffer(splittedData[0], 'hex')
  const encryptedData = new Buffer(splittedData[1], 'hex')
  const hash = this.createHashFromString(key)
  const decipher = crypto.createDecipheriv(ALGORITHM, hash, initializationVector)
  const decryptedData = decipher.update(encryptedData)
  const decryptedBuffer = Buffer.concat([decryptedData, decipher.final()])
  const jsonData = decryptedBuffer.toString()
  return JSON.parse(jsonData)
}

/**
 * @summary Decrypt data from a file
 * @param {string} filepath - the path of the file containing crypted data
 * @param {string | Buffer | TypedArray | DataView} key - the encryption key
 * @returns {Promise<*>} The decrypted data
 */
exports.decryptFromFile = function (filepath, key) {
  const {
    fs,
    logger,
  } = this.modules

  const readFile = promisify(fs.readFile)
  return readFile(filepath, ENCODING)
    .then((data) => {
      return this.decrypt(data, key)
    })
    .catch((error) => {
      logger.error('cryptoHelper: cannot decrypt from file', error)
      throw error
    })
}


/**
 * @summary Decrypt data from a file
 * @param {string} filepath - the path of the file containing crypted data
 * @returns {Promise<*>} The decrypted data
 */
exports.decryptFromFileWithUUID = function (filepath) {
  const {
    logger,
  } = this.modules

  const uuid = this.getUUID()
  return this.decryptFromFile(filepath, uuid)
    .catch((error) => {
      logger.error('cryptoHelper: cannot decrypt from file (UUID error)', error)
      throw error
    })
}


/**
 * @summary Compute the file hash
 * @param {String} absoluteFilePath - absolute path of the file
 * @returns {Promise} a promise that resolve with the hash of the file
 */
exports.getFileHash = function (absoluteFilePath) {
  const {
    crypto,
    fs,
  } = this.modules

  return new Promise((resolve) => {
    const sha1 = crypto.createHash('sha1')
    const stream = fs.createReadStream(absoluteFilePath)

    stream.on('error', () => {
      resolve(0)
    })
    stream.on('data', (data) => {
      sha1.update(data)
    })
    stream.on('end', () => {
      const hash = sha1.digest('hex')
      resolve(hash)
    })
  })
}
