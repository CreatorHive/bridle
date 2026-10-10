/** The 38px chrome strip: draggable, traffic lights on the left, the current title centered. */
export function TitleBar({ title }: { title: string }) {
  return (
    <header className="titlebar">
      <h1>{title}</h1>
    </header>
  )
}
