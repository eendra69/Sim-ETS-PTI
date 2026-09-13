CREATE TABLE IF NOT EXISTS compliance_import_batches (
  import_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_code text NOT NULL UNIQUE,
  dataset_sha256 text NOT NULL,
  data_origin text NOT NULL CHECK (data_origin IN ('OFFICIAL', 'SYNTHETIC')),
  seed_version integer NOT NULL CHECK (seed_version > 0),
  covered_years integer[] NOT NULL,
  participant_count integer NOT NULL CHECK (participant_count > 0),
  position_row_count integer NOT NULL CHECK (position_row_count > 0),
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS scale_class text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'UNSPECIFIED';

ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_scale_class_check;
ALTER TABLE participants ADD CONSTRAINT participants_scale_class_check
  CHECK (scale_class IS NULL OR scale_class IN ('SMALL', 'MEDIUM', 'LARGE'));

ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_data_origin_check;
ALTER TABLE participants ADD CONSTRAINT participants_data_origin_check
  CHECK (data_origin IN ('UNSPECIFIED', 'OFFICIAL', 'SYNTHETIC'));

ALTER TABLE annual_compliance_positions
  DROP CONSTRAINT IF EXISTS annual_compliance_positions_source_status_check;
ALTER TABLE annual_compliance_positions
  ADD CONSTRAINT annual_compliance_positions_source_status_check
  CHECK (source_status IN ('PROJECTED', 'PROVISIONAL', 'VERIFIED'));

ALTER TABLE annual_compliance_positions
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'UNSPECIFIED';
ALTER TABLE annual_compliance_positions
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES compliance_import_batches(import_batch_id);

ALTER TABLE annual_compliance_positions
  DROP CONSTRAINT IF EXISTS annual_compliance_positions_data_origin_check;
ALTER TABLE annual_compliance_positions
  ADD CONSTRAINT annual_compliance_positions_data_origin_check
  CHECK (data_origin IN ('UNSPECIFIED', 'OFFICIAL', 'SYNTHETIC'));

CREATE INDEX IF NOT EXISTS idx_compliance_import_batch
  ON annual_compliance_positions (import_batch_id);

