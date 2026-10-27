#!/bin/sh
set -e

echo "Waiting for Postgres, GoTrue (auth), and Storage schemas to be ready..."
until PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users'" | grep -q 1 \
  && PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects'" | grep -q 1; do
  sleep 2
done

PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -tAc "CREATE TABLE IF NOT EXISTS public._baergpt_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now());" >/dev/null

echo "Applying BärGPT SQL migrations..."
for f in /migrations/*.sql; do
  MIGRATION_NAME=$(basename "$f")
  ALREADY=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -tAc "SELECT 1 FROM public._baergpt_migrations WHERE name = '$MIGRATION_NAME'" || true)
  if [ "$ALREADY" != "1" ]; then
    echo "  -> $MIGRATION_NAME"
    PGPASSWORD="$POSTGRES_PASSWORD" PGOPTIONS="-c search_path=public,extensions" psql -v ON_ERROR_STOP=1 -h db -U supabase_admin -d postgres -f "$f"
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -tAc "INSERT INTO public._baergpt_migrations (name) VALUES ('$MIGRATION_NAME') ON CONFLICT DO NOTHING;" >/dev/null
  fi
done
echo "All migrations applied successfully."

echo "Ensuring realtime publications for documents and document_folders..."
PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres <<'SQL' || true
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'document_folders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.document_folders;
  END IF;
END $$;
SQL

echo "Database initialization complete."
