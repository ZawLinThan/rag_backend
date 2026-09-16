import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'

/**
 * Creates a request-scoped Supabase client and collects response cookie headers.
 *
 * @param request - The incoming request containing authentication cookies.
 * @returns The Supabase client and headers to attach to the response.
 */
export function createClient(request: Request) {
  const headers = new Headers()

  const supabase = createServerClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        /**
         * Reads authentication cookies from the incoming request.
         *
         * @returns The parsed cookie names and values.
         */
        getAll() {
          return parseCookieHeader(request.headers.get('Cookie') ?? '') as {
            name: string
            value: string
          }[]
        },
        /**
         * Appends authentication cookie updates to the response headers.
         *
         * @param cookiesToSet - The cookie names, values, and serialization options.
         */
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            headers.append('Set-Cookie', serializeCookieHeader(name, value, options))
          )
        },
      },
    }
  )

  return { supabase, headers }
}
