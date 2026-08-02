'use client'

/**
 * Standalone "Sources" screen (matches the Claude Design mockup's `P.sources`).
 * All of the actual list/add/test/scan/delete logic — plus the page header
 * (it already knows the live source count for the subtitle) — lives in
 * LibrarySourcesPanel; this route just mounts it.
 */

import LibrarySourcesPanel from '@/components/LibrarySourcesPanel'

export default function SourcesPage() {
  return <LibrarySourcesPanel />
}
