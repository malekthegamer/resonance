/**
 * Single source of truth for IPC channel names.
 *
 * Both sides import from here so a renamed channel is a type error rather than
 * a silent no-op — a message sent on a channel nobody listens to fails quietly,
 * which is exactly the class of bug that is expensive to find later.
 */
export const IPC = {
  // Diagnostics
  PING: 'app:ping',
  APP_INFO: 'app:info',

  // Window controls (frameless chrome)
  WIN_MINIMIZE: 'win:minimize',
  WIN_TOGGLE_MAXIMIZE: 'win:toggleMaximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  WIN_MAXIMIZE_CHANGED: 'win:maximizeChanged',

  // Library database
  DB_INFO: 'db:info',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
