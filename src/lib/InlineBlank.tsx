interface InlineBlankProps {
  value: string
  placeholder: string
  onChange: (value: string) => void
  widthCh?: number
}

// A textarea styled to sit inline inside a sentence, like the highlighted
// fill-in-the-blank tokens in a mad-lib — reads as highlighted text, not a
// form field. Deliberately a FIXED size regardless of content: it doesn't
// grow when populated, so the surrounding sentence's layout stays stable no
// matter what's typed. Stays a single line — wrap="off" plus the
// white-space: pre / overflow-x: auto rule on .madlib textarea means longer
// content scrolls sideways within the line instead of wrapping into extra
// rows of dead vertical space.
export function InlineBlank({ value, placeholder, onChange, widthCh = 14 }: InlineBlankProps) {
  return (
    <span className="blank-wrap">
      <textarea
        rows={1}
        wrap="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: `${widthCh}ch` }}
      />
    </span>
  )
}
