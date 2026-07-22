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
  LIB_PICK_AND_SCAN: 'lib:pickAndScan',
  LIB_SCAN_PATHS: 'lib:scanPaths',
  LIB_SCAN_PROGRESS: 'lib:scanProgress',
  LIB_CANCEL_SCAN: 'lib:cancelScan',
  LIB_GET_TRACKS: 'lib:getTracks',
  LIB_SEARCH: 'lib:search',
  LIB_STATS: 'lib:stats',

  // Playlists
  PL_LIST: 'pl:list',
  PL_CREATE: 'pl:create',
  PL_RENAME: 'pl:rename',
  PL_DELETE: 'pl:delete',
  PL_TRACKS: 'pl:tracks',
  PL_ADD: 'pl:add',
  PL_REMOVE: 'pl:remove',
  PL_REORDER: 'pl:reorder',
  PL_IMPORT: 'pl:import',
  PL_EXPORT: 'pl:export',

  // Track actions
  TRACK_REVEAL: 'track:reveal',
  TRACK_PLAYED: 'track:played',

  // Tag editing. Takes track ids, never paths — see src/main/ipc/tags.ts.
  TAGS_READ: 'tags:read',
  TAGS_WRITE: 'tags:write',
  TAGS_PICK_ARTWORK: 'tags:pickArtwork',

  // Media keys / tray commands -> renderer
  MEDIA_PLAY_PAUSE: 'media:playPause',
  MEDIA_NEXT: 'media:next',
  MEDIA_PREVIOUS: 'media:previous',
  MEDIA_STOP: 'media:stop',
  MEDIA_VOLUME_UP: 'media:volumeUp',
  MEDIA_VOLUME_DOWN: 'media:volumeDown',

  // Renderer -> main now-playing broadcast (tray tooltip, mini-player)
  NOW_PLAYING_CHANGED: 'np:changed',
  NOW_PLAYING_STATE: 'np:state',
  NOW_PLAYING_REQUEST: 'np:request',

  // Mini player
  MINI_TOGGLE: 'mini:toggle',
  MINI_CLOSE: 'mini:close',
  MINI_IS_OPEN: 'mini:isOpen',

  // Desktop integration
  SHORTCUT_STATUS: 'shortcuts:status',

  // Auto-update
  UPDATE_STATUS: 'update:status',
  UPDATE_STATUS_GET: 'update:statusGet',
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
