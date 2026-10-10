/** Initials: "Bridle" → "B", "Ruby Park" → "RP". */
export function initials(name: string): string {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** Avatar palettes: light, accent, dark. Index 0 is the main agent's indigo. */
const PALETTES: [number, number, number][] = [
  [0xa5b4fc, 0x6366f1, 0x3730a3], [0x7dd3fc, 0x0ea5e9, 0x075985], [0x99f6e4, 0x14b8a6, 0x115e59],
  [0xa7f3d0, 0x10b981, 0x065f46], [0xfde68a, 0xf59e0b, 0xb45309], [0xfed7aa, 0xf97316, 0xc2410c],
  [0xfecdd3, 0xfb7185, 0xbe123c], [0xfbcfe8, 0xec4899, 0x9d174d], [0xddd6fe, 0x8b5cf6, 0x5b21b6],
  [0xc4b5fd, 0x7c3aed, 0x4338ca]
]

/** FNV-1a with a murmur-style finalizer, salted per use (UInt32 math). */
export function avatarHash(salt: number, id: string): number {
  let h = 2166136261
  for (const byte of new TextEncoder().encode(`${salt}:actor_${id}`)) h = Math.imul(h ^ byte, 16777619) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

const hex = (c: number, a = 1) => `rgba(${c >> 16}, ${(c >> 8) & 255}, ${c & 255}, ${a})`

/** A glossy sphere whose palette, gradient angle and highlights all come from a hash
 *  of its id, so it looks the same everywhere. Returns the CSS background. */
export function sphere(id: string, palette?: number): string {
  const h = [0, 1, 2, 3].map((i) => avatarHash(i, id))
  const [light, accent, dark] = PALETTES[palette ?? h[0] % 10]
  const deg = 125 + (h[1] % 41)
  // The design's gradient runs corner-free across the unit square; CSS's runs corner to corner, so
  // the stops move in by the extra length.
  const rad = (deg * Math.PI) / 180
  const L = Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad))
  const at = (s: number) => `${((0.5 + (s - 0.5) / L) * 100).toFixed(1)}%`
  const shine = [7 + (h[2] % 30), 5 + (Math.floor(h[2] / 30) % 25)]
  const glow = [57 + (h[3] % 33), 52 + (Math.floor(h[3] / 33) % 34)]
  return [
    `radial-gradient(24% 24% at ${shine[0]}% ${shine[1]}%, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 50%, rgba(255,255,255,0))`,
    `radial-gradient(30% 30% at ${glow[0]}% ${glow[1]}%, ${hex(light)}, ${hex(light, 0)})`,
    `linear-gradient(${deg}deg, ${hex(light)} ${at(0)}, ${hex(accent)} ${at(0.48)}, ${hex(dark)} ${at(1)})`
  ].join(', ')
}

/** A photo when given, else the glossy sphere with initials (`lettered`).
 *  Without `seed` it's the main agent's indigo; with one, the seed picks a stable palette. */
export function Avatar({ name, seed, image, size = 30, lettered = true }:
  { name: string; seed?: string; image?: string | null; size?: number; lettered?: boolean }) {
  return (
    <span
      className={`b-avatar ${image ? 'photo' : ''}`}
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: image ? undefined : sphere(seed ?? name, seed === undefined ? 0 : undefined)
      }}
    >
      {image ? <img src={image} alt="" /> : lettered && initials(name)}
    </span>
  )
}
