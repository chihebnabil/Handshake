import { useRef, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { submitDeliveryFn } from '~/server/jobs'
import { MEDIA_TYPES, type DeliverableFile, type MediaType } from '~/lib/types'

const MAX_FILES = 6
// Serverless hosts cap request bodies (Vercel: 4.5 MB), and base64 adds a third. Keep the whole delivery under it.
const MAX_TOTAL_DATA_URL_CHARS = 4_000_000
const MAX_EDGE = 1600
const ACCEPT: readonly string[] = MEDIA_TYPES

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Large screenshots are downscaled so they fit the upload limit and review faster. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b && b.size < file.size ? b : file), 'image/jpeg', 0.82))
}

async function toDeliverableFile(file: File): Promise<DeliverableFile> {
  let blob: Blob = file
  let mediaType = file.type as MediaType
  if (file.type.startsWith('image/') && file.type !== 'image/gif' && file.size > 400_000) {
    blob = await shrinkImage(file)
    mediaType = blob === file ? mediaType : 'image/jpeg'
  }
  return { name: file.name, mediaType, dataUrl: await readAsDataUrl(blob) }
}

export function DeliveryForm({
  jobId,
  token,
  onStart,
  onDone,
}: {
  jobId: string
  token: string
  onStart: () => void
  onDone: () => void | Promise<void>
}) {
  const submit = useServerFn(submitDeliveryFn)
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<DeliverableFile[]>([])
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addFiles(list: FileList | null) {
    if (!list) return
    setError(null)
    try {
      const picked = Array.from(list).filter((f) => ACCEPT.includes(f.type))
      if (picked.length < list.length) setError('Only images (PNG, JPG, GIF, WebP) and PDFs are supported.')
      const converted = await Promise.all(picked.map(toDeliverableFile))
      const next = [...files, ...converted].slice(0, MAX_FILES)
      const total = next.reduce((n, f) => n + f.dataUrl.length, 0)
      if (total > MAX_TOTAL_DATA_URL_CHARS) {
        throw new Error('These files are too large together (about 3 MB max per delivery). Use fewer or smaller files, or add a link.')
      }
      setFiles(next)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function onSubmit() {
    setBusy(true)
    setError(null)
    onStart()
    try {
      await submit({ data: { id: jobId, token, note, link: link.trim(), files } })
      setFiles([])
      setNote('')
      setLink('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      await onDone()
    }
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          addFiles(e.dataTransfer.files)
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${
          drag ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'
        }`}
      >
        <p className="text-sm font-semibold text-ink-800">Drop files or click to upload</p>
        <p className="mt-1 text-xs text-ink-500">Images and PDFs, up to {MAX_FILES} files</p>
        <input ref={input} type="file" multiple accept={ACCEPT.join(',')} className="hidden" onChange={(e) => addFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="group relative overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
              {f.mediaType.startsWith('image/') ? (
                <img src={f.dataUrl} alt={f.name} className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square items-center justify-center p-2 text-center text-[11px] font-medium text-ink-600">📄 {f.name}</div>
              )}
              <button
                type="button"
                onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-ink-900/80 text-xs text-white group-hover:flex"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <input className="input" type="url" placeholder="Live link (optional): https://…" value={link} onChange={(e) => setLink(e.target.value)} />
      <textarea className="input min-h-20" placeholder="Note to the reviewer: what you delivered and where to find it" value={note} onChange={(e) => setNote(e.target.value)} />

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <button type="button" className="btn-primary w-full" disabled={busy || (!files.length && !note.trim() && !link.trim())} onClick={onSubmit}>
        {busy ? 'AI judge is reviewing…' : 'Submit for AI review'}
      </button>
    </div>
  )
}
