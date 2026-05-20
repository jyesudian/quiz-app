// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

// You can find your Supabase URL and Anon Key in your project's
// Settings > API page.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)