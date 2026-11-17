import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const url = rawUrl?.trim();
const key = rawKey?.trim();

const hasUnsupportedCharacters = (value: string) => /[^\x20-\x7E]/.test(value);
const hasInternalWhitespace = (value: string) => /\s/.test(value);

export const configurationError =
  !url || !key
    ? 'Supabase-এর URL অথবা Publishable Key পাওয়া যায়নি।'
    : hasUnsupportedCharacters(url) || hasUnsupportedCharacters(key)
      ? 'Supabase-এর URL বা Key-তে অস্বাভাবিক/বাংলা অক্ষর আছে। Cloudflare Variables-এ মানটি আবার পরীক্ষা করুন।'
      : hasInternalWhitespace(url) || hasInternalWhitespace(key)
        ? 'Supabase-এর URL বা Key-এর মধ্যে অতিরিক্ত Space বা line break আছে।'
        : '';

export const configured = !configurationError;
export const supabase = configured ? createClient(url!, key!) : null;
