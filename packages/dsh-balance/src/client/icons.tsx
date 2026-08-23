/**
 * Balance plugin — shared inline SVG icons.
 *
 * The floating dashboard header controls and the trend indicators were
 * previously rendered as Unicode text glyphs (− + ⛶ ⤢ ▦ ⟳ —, and ▲▼–). Those
 * glyphs vary by platform font and cannot be themed (they sit in the text
 * color, but their geometry is fixed by the font). These self-contained
 * stroke icons render identically everywhere, inherit the surrounding text
 * color via `currentColor`, and carry their own accessible presentation
 * (decorative by default, with `aria-label`/`aria-hidden` applied by callers).
 *
 * Geometry: 14×14 viewBox, 1.5px stroke, round caps/joins — matched to the
 * 13px control buttons and the 10px trend badge so the strokes look crisp at
 * the rendered sizes.
 *
 * @module @dsh-plugins/balance/client/icons
 */

import type { ReactNode, SVGProps } from 'react'

/** Shared props for the stroke icons: size + forward the rest to <svg>. */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** Build one 14×14 stroke icon around a single <path>/<g> body. */
function StrokeIcon(props: IconProps, body: ReactNode): JSX.Element {
  const { size = 14, ...rest } = props
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {body}
    </svg>
  )
}

/** Zoom out / remove — a horizontal bar. */
export function MinusIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <line x1="3" y1="7" x2="11" y2="7" />)
}

/** Zoom in / add — a cross. */
export function PlusIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g><line x1="3" y1="7" x2="11" y2="7" /><line x1="7" y1="3" x2="7" y2="11" /></g>)
}

/** Collapse — a heavier horizontal bar (docked/collapsed affordance). */
export function CollapseIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <line x1="2.5" y1="7" x2="11.5" y2="7" strokeWidth={1.75} />)
}

/** Dock to a corner — a rounded frame. */
export function DockIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <rect x="2.75" y="2.75" width="8.5" height="8.5" rx="2" />)
}

/** Dock into the card container — a grid with a slot the widget enters. */
export function DockToCardIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g>
    <rect x="2.25" y="2.25" width="9.5" height="9.5" rx="2" />
    <line x1="7" y1="5" x2="7" y2="9" />
    <line x1="5" y1="7" x2="9" y2="7" />
  </g>)
}

/** Toggle account mode — a 2×2 grid. */
export function GridModeIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g>
    <rect x="2.5" y="2.5" width="3.75" height="3.75" rx="0.9" />
    <rect x="7.75" y="2.5" width="3.75" height="3.75" rx="0.9" />
    <rect x="2.5" y="7.75" width="3.75" height="3.75" rx="0.9" />
    <rect x="7.75" y="7.75" width="3.75" height="3.75" rx="0.9" />
  </g>)
}

/** Refresh — a circular arrow. */
export function RefreshIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g>
    <path d="M11.5 7a4.5 4.5 0 1 1-1.4-3.25" />
    <path d="M11.9 2.75v1.85H10.05" />
  </g>)
}

/** Trend up — a diagonal arrow toward the upper-right. */
export function TrendUpIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g>
    <path d="M3 11L11 3" />
    <path d="M5.5 3H11V8.5" />
  </g>)
}

/** Trend down — a diagonal arrow toward the lower-right. */
export function TrendDownIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g>
    <path d="M3 3L11 11" />
    <path d="M5.5 11H11V5.5" />
  </g>)
}

/** Trend flat — a short dash. */
export function TrendFlatIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <line x1="3.5" y1="7" x2="10.5" y2="7" />)
}

/** Ternaries for the trend glyph used in the widget / card / pill tip. */
export function trendIcon(trend: string, props: IconProps): JSX.Element | null {
  switch (trend) {
    case 'up': return <TrendUpIcon {...props} />
    case 'down': return <TrendDownIcon {...props} />
    case 'flat': return <TrendFlatIcon {...props} />
    default: return null
  }
}

/** Edit a binding — a pencil. */
export function EditIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g>
    <path d="M9.6 2.9l1.5 1.5a1 1 0 0 1 0 1.4l-5.6 5.6-2.3.7.7-2.3 5.6-5.6a1 1 0 0 1 .1-.3z" />
  </g>)
}

/** Remove a binding — a trash can. */
export function TrashIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g>
    <path d="M4 4.5h6" />
    <path d="M5.5 4.5V3.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V4.5" />
    <path d="M4.75 4.5l.4 6a.75.75 0 0 0 .75.7h2.2a.75.75 0 0 0 .75-.7l.4-6" />
  </g>)
}

/** Close / cancel — an × . */
export function CloseIcon(props: IconProps): JSX.Element {
  return StrokeIcon(props, <g><path d="M4 4l6 6M10 4l-6 6" /></g>)
}
