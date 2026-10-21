import { createClient } from '@supabase/supabase-js'

// read before the client starts, it may clean the url while handling the email confirmation link
export const initialUrlParams = typeof window === 'undefined' ? '' : (window.location.hash || window.location.search)

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    // the heartbeat runs in a web worker: browsers throttle timers of background tabs, which used to
    // let the realtime socket time out silently, so messages stopped arriving until a page reload
    realtime: { worker: true, heartbeatIntervalMs: 15000 }
  }
)
