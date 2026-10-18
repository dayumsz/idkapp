export const themes = [
  { id: 'black', name: 'Black', c: ['#000000', '#e8e8e8', '#e8e8e8'] },
  { id: 'concrete', name: 'Concrete', c: ['#181818', '#d8d8d8', '#d8d8d8'] },
  { id: 'terminal', name: 'Terminal', c: ['#000000', '#4cf06f', '#4cf06f'] },
  { id: 'amber', name: 'Amber', c: ['#080500', '#ffb000', '#ffb000'] },
  { id: 'bone', name: 'Bone', c: ['#e8e5dc', '#111111', '#111111'] }
]

export const getTheme = () => {
  try {
    const t = localStorage.getItem('theme')
    return themes.some(x => x.id === t) ? t : 'black'
  } catch { return 'black' }
}

export const setTheme = id => {
  document.documentElement.dataset.theme = id
  try { localStorage.setItem('theme', id) } catch {}
}
