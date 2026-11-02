-- Repair only the three demonstrated raw labels. Do not reinterpret explicit
-- foreign structured country data or mixed-country secondary locations.
UPDATE jobs SET location_region = 'us'
WHERE status = 'open' AND location_region = 'unknown'
  AND trim(location) IN ('Houston TX', 'Nashville TN', 'San Francisco Office')
  AND coalesce(location_country, '') IN ('', 'US', 'USA', 'United States', 'United States of America')
  AND coalesce(secondary_locations, '[]') = '[]';
