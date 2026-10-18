import './globals.css'

export const metadata = { title: 'Chat' }

const boot = "try{document.documentElement.dataset.theme=localStorage.getItem('theme')||'black'}catch(e){}"

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="black" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: boot }} /></head>
      <body>{children}</body>
    </html>
  )
}
