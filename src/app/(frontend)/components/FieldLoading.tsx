const PHRASES = [
  'Counting marmots…',
  'Hauling field gear up Gothic Mountain…',
  'Asking the pikas politely…',
  'Waiting for the snow to melt…',
  'Pressing flowers between pages…',
  'Translating bumblebee dialect…',
  'Checking billy barr’s snow log…',
  'Flipping through field notebooks…',
  'Hiking up to the next plot…',
  'Triangulating from the cairns…',
  'Calibrating the data logger…',
  'Waiting on a mule deer crossing…',
]

export default function FieldLoading({ phrase }: { phrase?: string }) {
  const text = phrase ?? PHRASES[Math.floor(Math.random() * PHRASES.length)]
  return (
    <div className="field-loading" role="status" aria-live="polite">
      <span className="field-loading__spinner" aria-hidden="true" />
      <span className="field-loading__text">{text}</span>
    </div>
  )
}
