/**
 * @summary Ratings
 * @module zaap/games/ratings
 */

const inject = require('instill')

inject(exports, {
  app: require('../app'),
})

// eslint-disable-next-line camelcase
const DESCRIPTORS = {
  D_ALCOHOL_REFERENCE: 'Alcohol Reference',
  D_ANIMATED_BLOOD: 'Animated Blood',
  D_BLOOD: 'Blood',
  D_BLOOD_AND_GORE: 'Blood and Gore',
  D_CARTOON_VIOLENCE: 'Cartoon Violence',
  D_COMIC_MISCHIEF: 'Comic Mischief',
  D_CRUDE_HUMOR: 'Crude Humor',
  D_DRUG_REFERENCE: 'Drug Reference',
  D_FANTASY_VIOLENCE: 'Fantasy Violence',
  D_INTENSE_VIOLENCE: 'Intense Violence',
  D_LANGUAGE: 'Language',
  D_LYRICS: 'Lyrics',
  D_MATURE_HUMOR: 'Mature Humor',
  D_NUDITY: 'Nudity',
  D_PARTIAL_NUDITY: 'Partial Nudity',
  D_REAL_GAMBLING: 'Real Gambling',
  D_SEXUAL_CONTENT: 'Sexual Content',
  D_SEXUAL_THEMES: 'Sexual Themes',
  D_SEXUAL_VIOLENCE: 'Sexual Violence',
  D_SIMULATED_GAMBLING: 'Simulated Gambling',
  D_STRONG_LANGUAGE: 'Strong Language',
  D_STRONG_LYRICS: 'Strong Lyrics',
  D_STRONG_SEXUAL_CONTENT: 'Strong Sexual Content',
  D_SUGGESTIVE_THEMES: 'Suggestive Themes',
  D_TOBACCO_REFERENCE: 'Tobacco Reference',
  D_USE_OF_ALCOHOL: 'Use of Alcohol',
  D_USE_OF_DRUGS: 'Use of Drugs',
  D_USE_OF_TOBACCO: 'Use of Tobacco',
  D_VIOLENCE: 'Violence',
  D_VIOLENT_REFERENCES: 'Violent References',
}

const isDescriptorId = id => id.substr(0, 2) === 'D_'
const isCategoryId = id => !isDescriptorId(id)

/**
 * @summary Get the rating system used in the country of the operating system
 * @returns {String} 'pegi' or 'esrb'
 */
exports.getRatingSystem = function () {
  const {
    app,
  } = this.modules

  const ESRB_AREAS = ['en-US', 'en-CA']
  return ESRB_AREAS.includes(app.getLocale()) ? 'esrb' : 'pegi'
}

/**
 * @summary Create an object containing well formatted categories and descriptors for the rating system in use.
 *          Categories are image filenames. eg: "pegi/age12.svg"
 *          Descriptors are texts. eg: "Violence"
 * @param {any} release - Release object that contains the ratings found in the release.json
 * @returns {Object} The formatted categories and descriptors
 */
exports.get = function (release) {
  const system = this.getRatingSystem()
  const ratings = release && release.ratings ? release.ratings[system] : []

  const categories = ratings
    .filter(isCategoryId)
    .map(id => {
      return `${system}/${id.toLowerCase().replace('_', '-')}`
    })

  const descriptors = ratings
    .filter(isDescriptorId)
    .map(id => DESCRIPTORS[id])
    .filter(descriptor => !!descriptor)

  return {
    categories,
    descriptors,
  }
}
