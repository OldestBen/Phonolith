'use client'

interface VizFilters {
  showAlbum: boolean
  showCollaborator: boolean
  showProducer: boolean
  showEra: boolean
  albumFilter: string
  decadeFilter: string
  viewMode: 'galaxy' | 'timeline'
}

interface VizControlsProps {
  filters: VizFilters
  onFiltersChange: (f: VizFilters) => void
  albums: string[]
}

export default function VizControls({ filters, onFiltersChange, albums }: VizControlsProps) {
  const update = (patch: Partial<VizFilters>) => onFiltersChange({ ...filters, ...patch })

  const decades = ['All', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']

  const ConnectionToggle = ({
    label, value, field, color,
  }: { label: string; value: boolean; field: keyof VizFilters; color: string }) => (
    <label className="flex items-center gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={value}
        onChange={e => update({ [field]: e.target.checked } as Partial<VizFilters>)}
        className="sr-only"
      />
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
        value ? 'border-transparent' : 'border-border'
      }`} style={value ? { backgroundColor: color } : {}}>
        {value && <svg width="10" height="10" viewBox="0 0 10 10" fill="white"><path d="M1.5 5l2.5 2.5 4.5-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
        <span className="text-xs text-text-muted group-hover:text-text-primary transition-colors">{label}</span>
      </div>
    </label>
  )

  return (
    <div className="w-52 bg-surface/90 backdrop-blur-sm border-r border-border h-full flex flex-col overflow-y-auto">
      <div className="p-3 border-b border-border">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => update({ viewMode: 'galaxy' })}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              filters.viewMode === 'galaxy'
                ? 'bg-accent text-background'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Galaxy
          </button>
          <button
            onClick={() => update({ viewMode: 'timeline' })}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              filters.viewMode === 'timeline'
                ? 'bg-accent text-background'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Timeline
          </button>
        </div>
      </div>

      <div className="p-3 border-b border-border">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Connections</p>
        <div className="space-y-2.5">
          <ConnectionToggle label="Album" value={filters.showAlbum} field="showAlbum" color="rgba(167,139,250,0.8)" />
          <ConnectionToggle label="Collaborators" value={filters.showCollaborator} field="showCollaborator" color="rgba(96,165,250,0.8)" />
          <ConnectionToggle label="Producer" value={filters.showProducer} field="showProducer" color="rgba(245,158,11,0.8)" />
          <ConnectionToggle label="Era (±2yr)" value={filters.showEra} field="showEra" color="rgba(52,211,153,0.8)" />
        </div>
      </div>

      <div className="p-3">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Filter</p>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-text-muted mb-1 block">Album</label>
            <select
              value={filters.albumFilter}
              onChange={e => update({ albumFilter: e.target.value })}
              className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="all">All Albums</option>
              {albums.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Decade</label>
            <select
              value={filters.decadeFilter}
              onChange={e => update({ decadeFilter: e.target.value })}
              className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              {decades.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
