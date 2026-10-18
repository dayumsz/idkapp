export default function Avatar({ url, name, size = 40, onClick }) {
  const s = { width: size, height: size, fontSize: size * 0.4 }
  const cls = `av${onClick ? ' click' : ''}`
  return url
    ? <img className={cls} src={url} style={s} alt="" onClick={onClick} />
    : <div className={cls} style={s} onClick={onClick}>{(name || '?')[0].toUpperCase()}</div>
}
