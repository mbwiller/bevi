-- The generator loads a JSON index beside its PNG style references.
-- export-style-refs.mjs uploads it with Content-Type application/json, but
-- 20261114000300 allowed only image types, so Storage rejects that final
-- upload even as service_role. Keep the bucket private and its existing cap.
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'application/json']
 where id = 'bev-style-refs';
