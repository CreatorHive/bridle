/** The 38px chrome strip: draggable, the window buttons over it (left on macOS, right elsewhere), the title centered. */
export function TitleBar({ title }: { title: string }) {
  return (
    <header className="titlebar">
      <h1>{title}</h1>
    </header>
  )
}
