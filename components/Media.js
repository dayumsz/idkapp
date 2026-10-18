'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'

const XIcon = () => (
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
    <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </svg>
)

const size = n => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`)

// pending attachment shown above the composer, before sending
export function Attachment({ att, busy, onToggle, onRemove }) {
  return (
    <div className={`attbar ${att.leaving ? 'out' : ''}`}>
      <div className="attcard">
        <div className={`pic ${att.spoiler ? 'hide' : ''} ${att.once ? 'once' : ''}`}>
          <img src={att.url} alt="" draggable={false} />
          {att.spoiler && <span className="spoiltag">Spoiler</span>}
          {att.once && <span className="oncetag">View once</span>}
          <button type="button" className="attx" disabled={busy} onClick={onRemove} aria-label="Remove attachment">
            <XIcon />
          </button>
        </div>
        <div className="attinfo">
          <span>{att.file.name}</span>
          <small>{size(att.file.size)}</small>
        </div>
        <div className="attopts">
          <button type="button" disabled={busy} className={`chip ${att.spoiler ? 'on' : ''}`} onClick={() => onToggle('spoiler')}>
            Spoiler
          </button>
          <button type="button" disabled={busy} className={`chip ${att.once ? 'on' : ''}`} onClick={() => onToggle('once')}>
            View once
          </button>
        </div>
      </div>
    </div>
  )
}

// image inside a message, hidden behind a blur when marked as spoiler
export function Pic({ src, spoiler }) {
  const [open, setOpen] = useState(!spoiler)
  const hidden = spoiler && !open
  return (
    <div className={`pic ${hidden ? 'hide' : ''} ${hidden ? 'click' : ''}`} onClick={() => hidden && setOpen(true)}>
      <img src={src} alt="" />
      {hidden && <span className="spoiltag">Spoiler</span>}
    </div>
  )
}

function Viewer({ mid, caption, onOpened, onClose }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const started = useRef(false)

  async function load() {
    setErr('')
    setUrl('')
    const { data: path, error } = await supabase.rpc('open_view_once', { mid })
    if (error) return setErr(error.message)
    onOpened()
    const { data, error: e2 } = await supabase.storage.from('chat-once').createSignedUrl(path, 60)
    if (e2 || !data) return setErr('Could not load the image')
    setUrl(data.signedUrl)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    load()
  }, [])

  return (
    <Modal onClose={onClose} className="onceview">
      {close => (
        <>
          <h3>View once</h3>
          {!url && !err && <p className="note">Loading<span className="caret">_</span></p>}
          {url && (
            <img
              className="onceimg"
              src={url}
              alt=""
              draggable={false}
              onContextMenu={e => e.preventDefault()}
              onError={() => setErr('Could not load the image')}
            />
          )}
          {err && <small className="err">{err}</small>}
          {caption && <p className="note">{caption}</p>}
          <div className="row-btns">
            {err && err !== 'Already opened' && <button onClick={load}>Try again</button>}
            <button className="ghost" onClick={close}>Close</button>
          </div>
          <small className="note">This photo disappears after you close it.</small>
        </>
      )}
    </Modal>
  )
}

// view once placeholder: recipients open it a single time, the sender only sees the status
export function Once({ m, mine, opened, count, isGroup, onOpened }) {
  const [show, setShow] = useState(false)
  let status
  if (mine) status = count > 0 ? (isGroup ? `Opened by ${count}` : 'Opened') : 'Not opened yet'
  else status = opened ? 'Opened' : 'View once'

  return (
    <>
      <div className={`oncecard ${!mine && opened ? 'done' : ''}`}>
        <i className="onceico">1</i>
        <div className="oncetxt">
          <span>Photo</span>
          <small>{status}</small>
        </div>
        {!mine && !opened && <button type="button" onClick={() => setShow(true)}>Open</button>}
      </div>
      {show && <Viewer mid={m.id} caption={m.body} onOpened={onOpened} onClose={() => setShow(false)} />}
    </>
  )
}
