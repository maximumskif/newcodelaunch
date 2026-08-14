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
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      title={iconOnly ? 'Click or drag an image here' : undefined}
      className={`group flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-center transition-colors ${
        iconOnly ? 'p-1.5' : compact ? 'p-4' : 'p-8'
      } ${
        isDragging
          ? 'border-purple-400 bg-purple-500/10'
          : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]'
      }`}
    >
      <IconUpload className={`${iconOnly ? 'h-4 w-4' : compact ? 'h-5 w-5' : 'h-7 w-7'} text-white/40 group-hover:text-white/60`} />
      {!iconOnly && (
        <p className={compact ? 'text-xs text-white/60' : 'text-sm text-white/70'}>
          {label ?? (
            <>
              <span className="text-purple-400">Click to upload</span> or drag and drop
            </>
          )}
        </p>
      )}
      {hint && !iconOnly && <p className="text-xs text-white/35">{hint}</p>}
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
