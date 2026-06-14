'use client'

interface TagBadgeProps {
  name: string
  color?: string
  onRemove?: () => void
  variant?: 'accent' | 'muted'
}

export default function TagBadge({ name, color, onRemove, variant = 'accent' }: TagBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded border ${
        variant === 'accent'
          ? 'bg-accent/10 text-accent border-accent/20'
          : 'bg-surface-2 text-text-muted border-border'
      }`}
    >
      {color && (
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      {name}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
          aria-label={`Remove tag ${name}`}
        >
          ×
        </button>
      )}
    </span>
  )
}
