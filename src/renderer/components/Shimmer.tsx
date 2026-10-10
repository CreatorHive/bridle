import type { CSSProperties, ReactNode } from 'react'

/** A skeleton block with a sweeping highlight. */
export function Shimmer({ width = '100%', height = 12, style }: { width?: number | string; height?: number | string; style?: CSSProperties }) {
  return <div className="b-shimmer" style={{ width, height, ...style }} />
}

/** Text with a light sweeping through it: the agent's working-row label ("Thinking"). */
export function ShimmerText({ children }: { children: ReactNode }) {
  return <span className="b-shimmer-text">{children}</span>
}
