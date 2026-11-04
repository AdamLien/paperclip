-- Keep each published page body with its revision so history can show diffs and restore.
-- Revisions written before this migration keep a NULL body and are reported as not diffable.
ALTER TABLE plugin_llm_wiki_8f50da974f.wiki_page_revisions ADD COLUMN IF NOT EXISTS body text;
