'use client'

import { createContext, useContext, useEffect, useState } from 'react'

interface PageHeaderState {
  title: string
  subtitle: string
}

interface PageHeaderCtx extends PageHeaderState {
  setHeader: (h: PageHeaderState) => void
}

const DEFAULT: PageHeaderState = { title: 'Phonolith', subtitle: '' }

const Ctx = createContext<PageHeaderCtx | null>(null)

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = useState<PageHeaderState>(DEFAULT)
  return <Ctx.Provider value={{ ...header, setHeader }}>{children}</Ctx.Provider>
}

function usePageHeaderCtx(): PageHeaderCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePageHeader must be used within PageHeaderProvider')
  return ctx
}

/**
 * The sticky AppHeader lives in the root layout, outside any single page's
 * scrollable content, so a page can't render it directly — instead each
 * page calls this hook with its title/subtitle and the header updates via
 * context. Resets to the default on unmount so navigating away doesn't leave
 * a stale title showing while the next page's effect hasn't fired yet.
 */
export function usePageHeader(title: string, subtitle: string = '') {
  const { setHeader } = usePageHeaderCtx()
  useEffect(() => {
    setHeader({ title, subtitle })
    return () => setHeader(DEFAULT)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle])
}

export function useCurrentPageHeader(): PageHeaderState {
  const { title, subtitle } = usePageHeaderCtx()
  return { title, subtitle }
}
