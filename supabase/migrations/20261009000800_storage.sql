insert into storage.buckets (id, name, public) values
  ('raw-uploads', 'raw-uploads', false),
  ('bev-photos', 'bev-photos', true),
  ('nutrition-labels', 'nutrition-labels', true),
  ('avatars', 'avatars', true),
  ('featured', 'featured', true)
on conflict (id) do nothing;
