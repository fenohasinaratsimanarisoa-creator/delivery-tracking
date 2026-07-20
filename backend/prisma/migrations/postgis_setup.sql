-- Run this when PostGIS is available (e.g. Docker postgis/postgis image)
-- psql -U delivery_user -d delivery_tracking -f postgis_setup.sql

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE gps_positions
  ALTER COLUMN location TYPE geography(Point, 4326)
  USING ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);

CREATE INDEX gps_positions_location_idx ON gps_positions USING GIST (location);
