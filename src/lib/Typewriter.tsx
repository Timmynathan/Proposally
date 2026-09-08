import { useEffect, useState } from 'react'

// Types `text` out a character at a time when `active` — used for the "I'm
// starting work on..." narration line, and only when `active` is true so
// reopening an already-finished proposal just shows the full line instantly
// rather than replaying the effect every time.
export function Typewriter({ text, active, speed = 18 }: { text: string; active: boolean; speed?: number }) {
  const [shown, setShown] = useState(active ? '' : text)

  useEffect(() => {
    if (!active) {
      setShown(text)
      return
    }
    setShown('')
    // Driven by elapsed wall-clock time rather than a per-tick counter, so a
    // throttled tab (backgrounded, minimized) that delays some interval
    // firings still catches up to the right position next time it fires,
    // instead of permanently freezing partway through.
    const start = Date.now()
    const id = window.setInterval(() => {
      const chars = Math.min(text.length, Math.floor((Date.now() - start) / speed))
      setShown(text.slice(0, chars))
      if (chars >= text.length) window.clearInterval(id)
    }, speed)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active, speed])

  return <>{shown}</>
}
