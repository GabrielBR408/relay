-- Channel creators must be able to read the row they just inserted
-- (insert ... returning runs the select policy before membership exists).
drop policy "members read channels" on public.channels;
create policy "members or creator read channels"
  on public.channels for select to authenticated
  using (public.is_member(id) or created_by = auth.uid());
