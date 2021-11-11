const ArchivesAdapter = require('./adapter')
const { readFile, writeFile, access } = require('fs')
const { promisify } = require('es6-promisify')
const { SmartBuffer } = require('smart-buffer')
const { dirname } = require('path')
const fs = require('fs-extra')

SmartBuffer.prototype.readUTF = function () {
  const len = this.readInt16BE()
  const utf = this._buff.toString('utf8', this.readOffset, this.readOffset + len)
  this.readOffset += len
  return utf
}

SmartBuffer.prototype.writeUTF = function (str) {
  const len = Buffer.byteLength(str)
  this.writeInt16BE(len)
  this._ensureWriteable(len)
  const writed = this._buff.write(str, this.writeOffset, len)
  this.writeOffset += len
  return writed
}

/**
 * @summary D2PAdapter
 */
class D2PAdapter extends ArchivesAdapter {
  /**
   * @summary error name when this is not a valid d2p file version
   */
  static get WRONG_D2P_VERSION_ERROR_NAME() {
    return 'WRONG_D2P_VERSION_ERROR'
  }

  /**
   * @summary error name when the file does not exists
   */
  static get D2P_DOES_NOT_EXISTS_ERROR_NAME() {
    return 'D2P_DOES_NOT_EXISTS_ERROR'
  }

  /**
   */
  constructor() {
    super()
  }

  /**
   * @param {String} filepath filepath
   * @returns {Promise} *
   */
  extract(filepath, {
    readFileAsync = promisify(readFile),
    accessAsync = promisify(access),
  } = {}) {
    return accessAsync(filepath)
      .then(() => readFileAsync(filepath))
      .then((buffer) => {
        const mBuffer = SmartBuffer.fromBuffer(buffer)

        const version = {
          major: mBuffer.readInt8(),
          minor: mBuffer.readInt8(),
        }

        if (version.major !== 2 || version.minor !== 1) {
          const error = new Error(`Unsupported d2p version ${version.major}.${version.minor}. We support only 2.1`)
          error.name = D2PAdapter.WRONG_D2P_VERSION_ERROR_NAME
          throw error
        }

        mBuffer.readOffset = mBuffer.length - 24

        const offset = {
          dataOffset: mBuffer.readInt32BE(),
          dataCount: mBuffer.readInt32BE(),
          indexOffset: mBuffer.readInt32BE(),
          indexCount: mBuffer.readInt32BE(),
          propertiesOffset: mBuffer.readInt32BE(),
          propertiesCount: mBuffer.readInt32BE(),
        }

        const meta = {}
        meta.properties = []
        meta.files = []

        // Reading properties
        mBuffer.readOffset = offset.propertiesOffset

        for (let i = 0; i < offset.propertiesCount; i++) {
          meta.properties.push({
            key: mBuffer.readUTF(),
            value: mBuffer.readUTF(),
          })
        }

        // Reading indexes
        const indexes = new Map()
        mBuffer.readOffset = offset.indexOffset

        for (let i = 0; i < offset.indexCount; i++) {
          let filename = mBuffer.readUTF()

          const fileInfo = {
            fileOffset: mBuffer.readInt32BE(),
            fileSize: mBuffer.readInt32BE(),
          }
          fileInfo.fileOffset += offset.dataOffset
          meta.files.push(filename)
          indexes.set(filename, fileInfo)
        }

        const archives = {}

        // Reading files
        for (const [filename, fileInfo] of indexes) {
          mBuffer.readOffset = fileInfo.fileOffset
          const buffer = mBuffer.readBuffer(fileInfo.fileSize)
          archives[filename] = buffer
        }

        archives.meta = meta
        archives.indexes = indexes

        return archives
      })
      .catch((err) => {
        if (err.name === D2PAdapter.WRONG_D2P_VERSION_ERROR_NAME) {
          throw err
        }
        const error = new Error(`This file does not exists. (${filepath})`)
        error.name = D2PAdapter.D2P_DOES_NOT_EXISTS_ERROR_NAME
        throw error
      })
  }

  /**
   * @param {String} filepath Where to save the file
   * @param {Array<Object>} archives archives
   * @param {Object} meta meta
   * @returns {Promise} *
   */
  build(filepath, archives, meta, {
    writeFileAsync = promisify(writeFile),
    fsExtra = fs,
  } = {}) {
    return fsExtra.mkdirp(dirname(filepath))
      .then(() => {
        const buffer = SmartBuffer.fromBuffer(Buffer.from([]))

        // Ecriture du numero de version
        buffer.writeInt8(2)
        buffer.writeInt8(1)

        const indexesSmartBuffer = SmartBuffer.fromBuffer(Buffer.from([]))
        let offset = 2
        let count = 0
        const filesBuffer = archives.reduce((prev, current) => {
          indexesSmartBuffer.writeUTF(current.name.replace(/\\/g, '/'))
          indexesSmartBuffer.writeInt32BE(offset - 2)
          indexesSmartBuffer.writeInt32BE(current.buffer.length)
          offset += current.buffer.length
          count++
          return Buffer.concat([prev, current.buffer])
        }, Buffer.from([]))

        // Ecriture des datas
        buffer.writeBuffer(filesBuffer)

        // Ecriture de l'index
        const indexesBuffer = indexesSmartBuffer.toBuffer()
        buffer.writeBuffer(indexesBuffer)

        meta.properties = meta.properties || []

        // Ecriture des properties
        for (const property of meta.properties) {
          buffer.writeUTF(property.key)
          buffer.writeUTF(property.value)
        }

        // Ecriture des tailles et offsets des blocks
        // Offset des datas
        buffer.writeInt32BE(2)
        // Taille des datas
        buffer.writeInt32BE(filesBuffer.byteLength)
        // Offset des index
        buffer.writeInt32BE(2 + filesBuffer.byteLength)
        // Nombre d'entrés dans l'index
        buffer.writeInt32BE(count)
        // Offset des propriétés
        buffer.writeInt32BE(2 + filesBuffer.byteLength + indexesBuffer.byteLength)
        // Nombre d'entrés dans les propriétés
        buffer.writeInt32BE(meta.properties.length)

        return writeFileAsync(filepath, buffer.toBuffer())
      })
  }
}

module.exports = D2PAdapter
