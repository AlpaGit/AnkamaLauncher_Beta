const types = [
  // General application remote object synchronisations
  'SET_SETTINGS',
  'SET_AUTHENTICATED',
  'SET_BUILD_CONFIG',
  'SET_WINDOW_IS_FOCUSED',
  'SET_WINDOW_IS_MAXIMIZED',
  'SET_WINDOW_IS_FULLSCREEN',
  'SET_ZAAP_AUTO_UPDATER_PROGRESS',
  'SET_ZAAP_AUTO_UPDATER_READY',

  // Game to be displayed in the main view
  'DISPLAY_RELEASE',

  // Toggle release settings popup
  'OPEN_RELEASE_SETTINGS_POPUP',
  'CLOSE_RELEASE_SETTINGS_POPUP',

  // Toggle a popup to choose install path
  'OPEN_RELEASE_INSTALL_POPUP',
  'CLOSE_RELEASE_INSTALL_POPUP',

  // Toggle a popup to confirm uninstall
  'OPEN_RELEASE_UNINSTALL_POPUP',
  'CLOSE_RELEASE_UNINSTALL_POPUP',

  // Toggle Zaap settings popup
  'OPEN_ZAAP_SETTINGS_POPUP',
  'CLOSE_ZAAP_SETTINGS_POPUP',

  // This should only be called by the registry
  // whenever we receive sync data
  'RESET_GAMES',
  'SET_GAME',
  'REMOVE_GAME',
  'SET_RELEASE_INFORMATION',
  'SET_RELEASE_CONFIGURATION',
  'SET_RELEASE_SETTINGS',
  'SET_RELEASE_CURRENT_UPDATE',
  'SET_RELEASE_NEWS',
  'SET_ALL_NEWS',

  // Terms
  'SET_TERMS_CONTENT',
  'SET_NEEDS_TO_ACCEPT_NEW_TERMS',

  // Connectivity
  'SET_CONNECTIVITY',
]

// Since JavaScript doesn't have enums...
types.forEach(function (type) {
  exports[type] = type
})
