exports = module.exports = function (num) {
  const UNITS = ['', 'k', 'M', 'G', 'T']

  if (!Number.isFinite(parseInt(num))) {
    throw new TypeError(`Expected a finite number, got ${typeof num}: ${num}`)
  }

  const neg = num < 0

  if (neg) {
    num = -num
  }

  if (num < 1) {
    return (neg ? '-' : '') + num + ' '
  }

  const exponent = Math.min(Math.floor(Math.log10(num) / 3), UNITS.length - 1)
  const numStr = Number((num / Math.pow(1024, exponent)).toPrecision(3))
  const unit = UNITS[exponent]
  const localizedUnit = (i18n.locale === 'fr') ? 'o' : 'B'

  return (neg ? '-' : '') + numStr.toLocaleString() + ' ' + unit + localizedUnit
}
