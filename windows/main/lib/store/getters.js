exports.displayedRelease = function (state) {
  const {
    gameUid,
    name: releaseName,
  } = state.display.releaseView

  const game = state.games[gameUid]
  if (!game) {
    return null
  }

  return game.releases[releaseName]
}
