// The Supabase client used by our API routes.
//
// It uses the service role key, which means it SKIPS row level security.
// Anything that can reach this file can read and write every row, so keep it
// on the server and do your own checks inside each route.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Built on first use, not at import time.
//
// If this threw while being imported, `next build` would fail for anyone who
// has not got a .env.local yet, even though nothing actually needs the
// database to compile. Building the client lazily means the missing-key error
// shows up on the first real request instead, with the same clear message.
let client: SupabaseClient | null = null;

export function getSupabaseAdmin() {
  if (client) return client;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing Supabase env vars. Copy .env.example to .env.local and fill it in.",
    );
  }

  client = createClient(supabaseUrl, supabaseServiceRoleKey, {
    // No cookies and no session storage: this only ever runs on the server.
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}
