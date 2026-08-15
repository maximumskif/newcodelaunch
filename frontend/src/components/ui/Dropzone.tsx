import { useRef, useState, type DragEvent } from 'react'

import { IconUpload } from './icons'

interface Props {
  onFiles: (files: File[]) => void
  multiple?: boolean
  accept?: string
  label?: string
  hint?: string
  compact?: boolean
  iconOnly?: boolean
}

// Plain drag-and-drop + click-to-browse file input — no dropzone dependency,
// this app keeps its footprint to what wagmi/wallet-adapter already pull in.
export function Dropzone({
  onFiles,
  multiple = false,
  accept = 'image/png,image/webp',
  label,
  hint,
  compact = false,
  iconOnly = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    onFiles(Array.from(fileList))
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        // role="button" + tabIndex don't get native Enter/Space activation
        // the way a real <button> does — that has to be wired up by hand.
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      aria-label={iconOnly ? 'Click or drag an image here' : undefined}
      title={iconOnly ? 'Click or drag an image here' : undefined}
      className={`group flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-center transition-colors duration-150 ${
        iconOnly ? 'p-1.5' : compact ? 'p-4' : 'p-8'
      } ${
        isDragging
          ? 'border-accent-400 bg-accent-500/10'
          : 'border-border-strong bg-surface hover:border-ink-faint hover:bg-surface-hover'
      }`}
    >
      <IconUpload className={`${iconOnly ? 'h-4 w-4' : compact ? 'h-5 w-5' : 'h-7 w-7'} text-ink-faint group-hover:text-ink-muted`} />
      {!iconOnly && (
        <p className={compact ? 'text-xs text-ink-muted' : 'text-sm text-ink-muted'}>
          {label ?? (
            <>
              <span className="text-accent-400">Click to upload</span> or drag and drop
            </>
          )}
        </p>
      )}
      {hint && !iconOnly && <p className="text-xs text-ink-faint">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}
