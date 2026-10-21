import './globals.css'

export const metadata = { title: 'Chat' }

const boot = "try{document.documentElement.dataset.theme=localStorage.getItem('theme')||'black'}catch(e){}"

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="black" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
        {/* open the connections to the media hosts early so photos and GIFs start downloading sooner */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />}
        <link rel="preconnect" href="https://media.giphy.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://media.tenor.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  )
}
