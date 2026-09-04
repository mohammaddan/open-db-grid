// SQL editor pane backed by CodeMirror 6 (PostgreSQL dialect).
// Registers an EditorSelectionHandle per tab so commands (format, run) can
// manipulate the document without reaching into CM internals.

import { useEffect, useRef } from 'react'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor
} from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { sql, PostgreSQL, keywordCompletionSource } from '@codemirror/lang-sql'
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  HighlightStyle
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import type { EditorSelectionHandle } from '@renderer/state/editor'
import { editorHandles } from '@renderer/state/editor'
import { useExplorerStore } from '@renderer/state/explorer'

interface Props {
  tabId: string
  doc: string
  connectionId: string | null
  fontSize: number
  readOnly: boolean
  onChange: (doc: string) => void
  onExecute: (mode: 'current' | 'selection' | 'all') => void
  /** 1-based SQL error position from PostgreSQL; scrolled to + selected */
  errorPosition?: number
}

const langComp = new Compartment()

/** Table/column completion from whatever the explorer has cached. */
function schemaCompletions(getConnId: () => string | null) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const connectionId = getConnId()
    if (!connectionId) return null
    const store = useExplorerStore.getState()
    const word = ctx.matchBefore(/[\w".]+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null

    const options: Array<{ label: string; type: string; detail?: string; boost?: number }> = []
    const schemaRoot = store.childrenByKey[connectionId + ':schemas']
    for (const schemaNode of schemaRoot ?? []) {
      const schemaName = schemaNode.name
      const tables =
        store.childrenByKey[connectionId + ':tables:' + schemaName] ??
        store.childrenByKey[connectionId + ':views:' + schemaName] ??
        []
      for (const t of tables) {
        options.push({ label: t.name, type: 'class', detail: schemaName + '.' + t.name, boost: 1 })
        const cols = store.childrenByKey[connectionId + ':table-columns:' + schemaName + ':' + t.name]
        for (const c of cols ?? []) {
          options.push({ label: c.name, type: 'property', detail: t.name, boost: 0 })
        }
      }
    }
    if (options.length === 0 && !ctx.explicit) return null
    return { from: word.from, options, validFor: /^[\w".]*$/ }
  }
}

export function SqlEditor(props: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(props.onChange)
  const onExecuteRef = useRef(props.onExecute)
  const connIdRef = useRef(props.connectionId)
  onChangeRef.current = props.onChange
  onExecuteRef.current = props.onExecute
  connIdRef.current = props.connectionId

  // build the editor once per tab
  useEffect(() => {
    if (!hostRef.current) return

    const handle: EditorSelectionHandle = {
      getSelection: () => {
        const view = viewRef.current
        if (!view) return { from: 0, to: 0, selected: '' }
        const r = view.state.selection.main
        return { from: r.from, to: r.to, selected: view.state.doc.sliceString(r.from, r.to) }
      },
      replaceAll: (transform: (sql: string) => string) => {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc.toString()
        const next = transform(doc)
        if (next === doc) return
        view.dispatch({ changes: { from: 0, to: doc.length, insert: next } })
      },
      formatSelection: () => {
        const view = viewRef.current
        if (!view) return
        const r = view.state.selection.main
        if (r.to > r.from) {
          const selected = view.state.doc.sliceString(r.from, r.to)
          const next = transformSelected(selected)
          if (next !== selected) {
            view.dispatch({ changes: { from: r.from, to: r.to, insert: next } })
          }
        }
      }
    }
    editorHandles.set(props.tabId, handle)

    const runKeymap = keymap.of([
      { key: 'Mod-Enter', preventDefault: true, run: () => (onExecuteRef.current('current'), true) },
      { key: 'Shift-Mod-Enter', preventDefault: true, run: () => (onExecuteRef.current('all'), true) },
      { key: 'Alt-Mod-Enter', preventDefault: true, run: () => (onExecuteRef.current('selection'), true) }
    ])

    const base: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [schemaCompletions(() => connIdRef.current), keywordCompletionSource(PostgreSQL)] }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(sqlHighlight),
      langComp.of(langFor(props.connectionId)),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
      runKeymap,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString())
      }),
      EditorView.theme({
        '&': { fontSize: props.fontSize + 'px', height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--fg)' },
        '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto', lineHeight: '1.55' },
        '.cm-content': { caretColor: 'var(--accent)' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'var(--selection-bg)'
        },
        '.cm-gutters': {
          backgroundColor: 'var(--editor-bg)',
          color: 'var(--fg-dim)',
          borderRight: '1px solid var(--border)'
        },
        '.cm-activeLine': { background: 'var(--active-line)' },
        '.cm-activeLineGutter': { background: 'var(--active-line)', color: 'var(--fg-muted)' },
        '.cm-selectionMatch': { background: 'var(--active-bg)' },
        '.cm-foldGutter span': { color: 'var(--fg-dim)' },
        '.cm-foldGutter span:hover': { color: 'var(--fg)' }
      })
    ]

    const view = new EditorView({
      state: EditorState.create({
        doc: props.doc,
        extensions: props.readOnly ? [...base, EditorState.readOnly.of(true)] : base
      }),
      parent: hostRef.current
    })
    viewRef.current = view

    return () => {
      editorHandles.delete(props.tabId)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tabId])

  // reconfigure language + completions when the connection changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: langComp.reconfigure(langFor(props.connectionId))
    })
  }, [props.connectionId])

  // scroll to PostgreSQL error position when present
  useEffect(() => {
    const view = viewRef.current
    if (!view || !props.errorPosition || props.errorPosition <= 0) return
    const pos = Math.min(props.errorPosition - 1, view.state.doc.length)
    view.dispatch({
      selection: { anchor: pos, head: Math.min(pos + 12, view.state.doc.length) },
      scrollIntoView: true
    })
    view.focus()
  }, [props.errorPosition])

  // external doc replacement (e.g. history re-run) when the CM doc diverges
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (props.doc !== current && !view.hasFocus) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: props.doc } })
    }
  }, [props.doc])

  return <div className="sql-editor" ref={hostRef} />
}

function langFor(connectionId: string | null): Extension {
  return sql({ dialect: PostgreSQL, upperCaseKeywords: true })
}

/* Syntax palette driven by the theme's --syn-* tokens so the editor always
   matches the surrounding chrome in both dark and light themes. */
const sqlHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--syn-keyword)', fontWeight: '500' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.integer, t.float], color: 'var(--syn-number)' },
  { tag: [t.bool, t.null, t.constant(t.name)], color: 'var(--syn-type)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: 'var(--syn-operator)' },
  { tag: [t.punctuation, t.separator], color: 'var(--fg-muted)' },
  { tag: [t.variableName, t.propertyName, t.labelName], color: 'var(--fg)' },
  { tag: t.invalid, color: 'var(--danger)', textDecoration: 'underline wavy' }
])

function transformSelected(selected: string): string {
  return selected
}
