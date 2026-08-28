import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

// A visual-only deployment should still be reviewable before it is connected to
// a Supabase project. Authentication and messages remain unavailable until the
// two VITE_SUPABASE_* variables are configured in the hosting environment.
export const supabase = createClient(
  supabaseUrl ?? 'https://preview-placeholder.supabase.co',
  supabaseAnonKey ?? 'preview-only-no-database-connection'
);
