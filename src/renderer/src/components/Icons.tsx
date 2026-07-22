/**
 * Inline SVG icon set.
 *
 * Unicode glyphs and emoji were tried first and looked wrong: emoji render in
 * full colour on Windows (a blue box for the repeat symbol), and the arrow
 * glyphs vary by installed font. Inline SVG inherits `currentColor`, sits on the
 * pixel grid at every size, and looks identical on every machine.
 */

interface IconProps {
  size?: number
  className?: string
}

function Svg({
  size = 16,
  className,
  children
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const IconPrevious = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M18.5 5.5v13L9 12z" fill="currentColor" stroke="none" />
    <path d="M6 5.5v13" />
  </Svg>
)

export const IconNext = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5.5 5.5v13L15 12z" fill="currentColor" stroke="none" />
    <path d="M18 5.5v13" />
  </Svg>
)

export const IconStop = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconShuffle = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M16 4h4v4" />
    <path d="M4 20 20 4" />
    <path d="M16 20h4v-4" />
    <path d="M4 4l5 5" />
    <path d="M14.5 14.5 20 20" />
  </Svg>
)

export const IconRepeat = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M17 2.5 20.5 6 17 9.5" />
    <path d="M3.5 12V9a3 3 0 0 1 3-3h14" />
    <path d="M7 21.5 3.5 18 7 14.5" />
    <path d="M20.5 12v3a3 3 0 0 1-3 3h-14" />
  </Svg>
)

export const IconRepeatOne = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M17 2.5 20.5 6 17 9.5" />
    <path d="M3.5 12V9a3 3 0 0 1 3-3h14" />
    <path d="M7 21.5 3.5 18 7 14.5" />
    <path d="M20.5 12v3a3 3 0 0 1-3 3h-14" />
    <text
      x="12"
      y="15.4"
      textAnchor="middle"
      fontSize="8.5"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      1
    </text>
  </Svg>
)

export const IconVolume = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z" fill="currentColor" stroke="none" />
    <path d="M15 9.2a4 4 0 0 1 0 5.6" />
    <path d="M17.8 6.6a8 8 0 0 1 0 10.8" />
  </Svg>
)

export const IconVolumeMuted = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z" fill="currentColor" stroke="none" />
    <path d="M15.5 9.5 21 15" />
    <path d="M21 9.5 15.5 15" />
  </Svg>
)

export const IconQueue = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 6.5h11" />
    <path d="M4 12h11" />
    <path d="M4 17.5h7" />
    <path d="M17.5 10.5v7.2" />
    <circle cx="15.6" cy="18" r="1.9" fill="currentColor" stroke="none" />
    <path d="M17.5 10.5 21 9.2v2.4l-3.5 1.3" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconEqualizer = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 20V13M6 9V4" />
    <path d="M12 20v-4M12 12V4" />
    <path d="M18 20v-9M18 7V4" />
    <circle cx="6" cy="11" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="14" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="18" cy="9" r="1.9" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconSearch = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.6 15.6 4.2 4.2" />
  </Svg>
)

export const IconSun = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
  </Svg>
)

export const IconMoon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2z" />
  </Svg>
)

export const IconSongs = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 18V5.5l10-2V16" />
    <circle cx="6.4" cy="18" r="2.6" />
    <circle cx="16.4" cy="16" r="2.6" />
  </Svg>
)

export const IconAlbums = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="2.4" />
  </Svg>
)

export const IconArtists = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="8.4" r="3.9" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </Svg>
)

export const IconGenres = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3.2 20.8 12 12 20.8 3.2 12z" />
  </Svg>
)

export const IconRecent = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.2V12l3.2 2" />
  </Svg>
)

export const IconPlaylist = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 7h11M4 12h11M4 17h6" />
    <path d="M17.5 13v6" />
    <path d="M20.5 16h-6" />
  </Svg>
)

export const IconPlus = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconClose = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const IconMiniPlayer = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.4" />
    <rect x="12.5" y="12" width="7" height="5.4" rx="1.4" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconTimer = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="13.2" r="7.6" />
    <path d="M12 9.4v3.8l2.6 1.7" />
    <path d="M9.4 2.6h5.2" />
  </Svg>
)

export const IconSettings = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.11a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.11A1.6 1.6 0 0 0 4.6 8.9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.47 1z" />
  </Svg>
)

export const IconImport = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3v11" />
    <path d="M7.8 10.2 12 14.4l4.2-4.2" />
    <path d="M4.5 17v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V17" />
  </Svg>
)
