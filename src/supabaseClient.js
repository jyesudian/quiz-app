// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

// You can find your Supabase URL and Anon Key in your project's
// Settings > API page.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

console.log('Supabase client: Initializing with URL:', supabaseUrl);
if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase client error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing from environment variables! Please check your .env file and ensure it is in the root directory. You must also restart the Vite dev server (Ctrl+C and npm run dev) after creating or editing the .env file.');
}

// Fallback to placeholder if undefined to prevent app from crashing on start
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder-key')