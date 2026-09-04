import { useUiStore } from '@renderer/state/ui'

export function ConfirmDialog(): JSX.Element | null {
  const confirm = useUiStore((s) => s.confirm)
  const dismiss = useUiStore((s) => s.dismissConfirm)
  if (!confirm) return null
  return (
    <div className="modal-backdrop" onMouseDown={dismiss}>
      <div
        className={'modal confirm' + (confirm.danger ? ' danger' : '')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{confirm.title}</div>
        <div className="modal-message">{confirm.message}</div>
        {confirm.detail && <pre className="modal-detail">{confirm.detail}</pre>}
        <div className="modal-actions">
          <button className="btn" onClick={dismiss}>
            Cancel
          </button>
          <button
            className={'btn ' + (confirm.danger ? 'danger' : 'primary')}
            autoFocus
            onClick={() => {
              dismiss()
              confirm.onConfirm()
            }}
          >
            {confirm.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
