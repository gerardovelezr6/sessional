-- Public files of a tenant (logos, icons). Additive and re-runnable.
--
-- Every file lives under "<tenant id>/…" and is written only by the server with the service role,
-- after it has checked the person's permission and the file itself. There are deliberately no
-- storage policies for signed-in users: nobody can upload directly from a browser. The bucket is
-- public for reading because these files appear on public pages (the sign-in page, the favicon).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-assets', 'public-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
