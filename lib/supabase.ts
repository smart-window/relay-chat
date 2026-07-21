import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !publishableKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(url, publishableKey);
