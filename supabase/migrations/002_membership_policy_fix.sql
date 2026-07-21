-- Avoid recursive RLS checks when reading conversation_members.
create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = target_conversation_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

alter policy "Members read their conversations" on public.conversations
  using (public.is_conversation_member(id));
alter policy "Members read conversation membership" on public.conversation_members
  using (public.is_conversation_member(conversation_id));
alter policy "Members read messages" on public.messages
  using (public.is_conversation_member(conversation_id));
alter policy "Members send messages" on public.messages
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));
alter policy "Members start calls" on public.calls
  with check (caller_id = auth.uid() and public.is_conversation_member(conversation_id));
alter policy "Conversation members read media" on storage.objects
  using (bucket_id = 'media' and exists (
    select 1 from public.messages m
    where m.storage_path = name and public.is_conversation_member(m.conversation_id)
  ));
