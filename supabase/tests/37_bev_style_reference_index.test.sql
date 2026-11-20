begin;
select plan(6);

select is((select count(*)::integer from storage.buckets where id = 'bev-style-refs'),
          1, 'style reference bucket exists');
select is((select public from storage.buckets where id = 'bev-style-refs'),
          false, 'style references and their index stay private');
select is((select file_size_limit from storage.buckets where id = 'bev-style-refs'),
          1048576::bigint, 'one MiB per-object cap is preserved');
select ok((select 'application/json' = any(allowed_mime_types) from storage.buckets where id = 'bev-style-refs'),
          'the reference uploader can store index.json with its actual MIME type');
select ok((select array['image/png', 'image/jpeg'] <@ allowed_mime_types from storage.buckets where id = 'bev-style-refs'),
          'reference image uploads remain allowed');
select is((select cardinality(allowed_mime_types) from storage.buckets where id = 'bev-style-refs'),
          3, 'only reference images and JSON are accepted');

select * from finish();
rollback;
