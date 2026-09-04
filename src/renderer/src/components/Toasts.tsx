import { useUiStore } from '@renderer/state/ui'

const ICONS = { info: 'ℹ', error: '✖', success: '✔' } as const

export function Toasts(): JSX.Element {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <span className="toast-icon">{ICONS[t.kind]}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
