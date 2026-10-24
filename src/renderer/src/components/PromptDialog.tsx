import { useState, useEffect, useRef } from 'react'
import { useUiStore } from '@renderer/state/ui'

export function PromptDialog(): JSX.Element | null {
  const prompt = useUiStore((s) => s.prompt)
  const dismiss = useUiStore((s) => s.dismissPrompt)
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (prompt) {
      setVal(prompt.defaultValue ?? '')
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    }
  }, [prompt])

  if (!prompt) return null

  const handleConfirm = () => {
    const trimmed = val.trim()
    if (!trimmed) return
    dismiss()
    prompt.onConfirm(trimmed)
  }

  return (
    <div className="modal-backdrop" onMouseDown={dismiss}>
      <div
        className="modal prompt-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{prompt.title}</div>
        {prompt.message && <div className="modal-message">{prompt.message}</div>}
        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <input
            ref={inputRef}
            className="field-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={val}
            placeholder={prompt.placeholder ?? ''}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm()
              if (e.key === 'Escape') dismiss()
            }}
          />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={dismiss}>
            Cancel
          </button>
          <button
            className="btn primary cyber-btn"
            disabled={!val.trim()}
            onClick={handleConfirm}
          >
            {prompt.confirmLabel ?? 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
