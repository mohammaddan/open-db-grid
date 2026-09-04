// React 19 removed the global JSX namespace. Components in this codebase use
// the concise `: JSX.Element` return annotation, so we restore a minimal
// global alias. JSX element checking itself is unaffected (it resolves through
// react/jsx-runtime under the automatic transform).

import type { JSX as ReactJSX } from 'react'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = ReactJSX.Element
    type ElementType = ReactJSX.ElementType
    type ElementClass = ReactJSX.ElementClass
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute
  }
}

export {}
