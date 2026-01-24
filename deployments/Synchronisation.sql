-- ---------- Types ----------
create type object_type as enum(
'collections',
'collectionContents',
'annotations',
'models'
);
create type permission as enum('R', 'RW', 'RWD');
-- ---------- Tables ----------
create table if not exists public.backup (
                                             id uuid not null default gen_random_uuid(),
    owner_id uuid not null,
    object_id uuid not null,
    object_type object_type not null,
    content jsonb not null,
    updated_at timestamp with time zone not null default now(),
    deleted_at timestamp with time zone check (deleted_at <= (now() +
    '00:00:01'::interval)),
    change_id uuid not null,
    part_of uuid,
    constraint backup_pkey primary key (id),
    constraint backup_owner_id_fkey foreign key (owner_id) references
    auth.users(id) on delete cascade,
    constraint backup_part_of_fkey1 foreign key (part_of) references
    public.backup(id) on delete cascade,
    constraint backup_unique unique (owner_id, object_type, object_id)
    );
create table if not exists public.backup_shares (
                                                    id uuid not null default gen_random_uuid(),
    backup_id uuid not null,
    shared_user uuid not null,
    permission permission not null,
    constraint backup_shares_pkey primary key (id),
    CONSTRAINT backup_shares_unique UNIQUE (backup_id, shared_user),
    constraint backup_shares_shared_user_fkey foreign key (shared_user)
    references auth.users(id) on delete cascade,
    constraint backup_shares_backup_id_fkey foreign key (backup_id) references
    public.backup(id) on delete cascade
    );

alter table public.backup enable row level security;
alter table public.backup_shares enable row level security;
alter publication supabase_realtime
add table public.backup;
alter publication supabase_realtime
add table public.backup_shares;
create index if not exists idx_backup_part_of on public.backup (part_of);
create index if not exists idx_backup_shares_backup_user on
    public.backup_shares (backup_id, shared_user);
-- ---------- Fonctions ----------
-- Vérifie si l'utilisateur est owner du parent
create or replace function is_parent_owner(parent_id uuid, user_id uuid)
returns boolean as $$
select exists (
    select 1
    from public.backup parent
    where parent.id = parent_id
      and parent.owner_id = user_id
);
$$ language sql security definer;
-- Vérifie si l'utilisateur a un share sur la row ou son parent avec une liste
de permissions
create or replace function is_shared_with(
backup_id uuid,
parent_id uuid,
user_id uuid,
perms permission[]
) returns boolean as $$
select exists (
    select 1
    from public.backup_shares s
    where s.shared_user = user_id
      and s.backup_id in (backup_id, parent_id)
      and s.permission = any(perms)
);
$$ language sql security definer;

-- ---------- backup : SELECT ----------
create policy backup_select on public.backup for select
                                                        using (
                                                        owner_id = auth.uid()::uuid
                                                        or (part_of is not null and is_parent_owner(part_of, auth.uid()::uuid))
                                                        or is_shared_with(id, part_of, auth.uid()::uuid,
                                                        array['R'::permission,'RW'::permission,'RWD'::permission])
                                                        );
-- ---------- backup : INSERT ----------
create policy backup_insert on public.backup for insert
with check (
(part_of is null and owner_id = auth.uid()::uuid)
or (part_of is not null and (
is_parent_owner(part_of, auth.uid()::uuid)
or is_shared_with(null, part_of, auth.uid()::uuid,
array['RW'::permission,'RWD'::permission])
)
)
);
-- ---------- backup : UPDATE ----------
create policy backup_update on public.backup for update
                                                            using (
                                                            owner_id = auth.uid()::uuid
                                                            or (part_of is not null and is_parent_owner(part_of, auth.uid()::uuid))
                                                            or is_shared_with(id, part_of, auth.uid()::uuid,
                                                            array['RW'::permission,'RWD'::permission])
                                                            )
                                                 with check (
                                                            owner_id = auth.uid()::uuid
                                                            or (part_of is not null and is_parent_owner(part_of, auth.uid()::uuid))
                                                            or is_shared_with(id, part_of, auth.uid()::uuid,
                                                            array['RW'::permission,'RWD'::permission])
                                                            );
-- ---------- backup : DELETE ----------
create policy backup_delete on public.backup for delete
using (
owner_id = auth.uid()::uuid
or (part_of is not null and is_parent_owner(part_of, auth.uid()::uuid))

or is_shared_with(id, part_of, auth.uid()::uuid, array['RWD'::permission])
);
-- ---------- backup_shares : SELECT ----------
create policy backup_shares_select on public.backup_shares for select
                                                                   using (
                                                                   shared_user = auth.uid()::uuid
                                                                   or exists (
                                                                   select 1
                                                                   from public.backup b
                                                                   where b.id = backup_shares.backup_id
                                                                   and b.owner_id = auth.uid()::uuid
                                                                   )
                                                                   );
-- ---------- backup_shares : INSERT ----------
create policy backup_shares_insert on public.backup_shares for insert
with check (
exists (
select 1
from public.backup b
where b.id = backup_id
and b.part_of is null
and b.owner_id = auth.uid()::uuid
)
);
-- ---------- backup_shares : UPDATE ----------
create policy backup_shares_update on public.backup_shares for update
                                                                          using (
                                                                          exists (
                                                                          select 1
                                                                          from public.backup b
                                                                          where b.id = backup_shares.backup_id
                                                                          and b.owner_id = auth.uid()::uuid
                                                                          )
                                                                          )
                                                               with check (
                                                                          exists (
                                                                          select 1
                                                                          from public.backup b
                                                                          where b.id = backup_shares.backup_id

                                                                          and b.owner_id = auth.uid()::uuid
                                                                          )
                                                                          );
-- ---------- backup_shares : DELETE ----------
create policy backup_shares_delete on public.backup_shares for delete
using (
exists (
select 1
from public.backup b
where b.id = backup_shares.backup_id
and b.part_of is null
and b.owner_id = auth.uid()::uuid
)
);
-- ---------- Share function ------------------
create or replace function public.share_backup_to_email(
target_email text,
target_backup_id uuid,
target_permission permission
)
returns jsonb
language plpgsql
security definer
as $$
declare
target_uid uuid;
begin
-- Résolution UID
select id into target_uid
from auth.users
where email = target_email;
if target_uid is null then
return jsonb_build_object(
'success', false,
'message', format('User with email % not found', target_email)
);
end if;
-- Tentative d'insertion encapsulée

begin
insert into public.backup_shares (
    shared_user,
    backup_id,
    permission
)
values (
           target_uid,
           target_backup_id,
           target_permission
       );
exception
when others then
-- Toute erreur SQL / RLS / contrainte / unique, etc.
return jsonb_build_object(
'success', false,
'message', format(
'Failed to share backup: %s',
sqlerrm
)
);
end;
-- Succès
return jsonb_build_object(
        'success', true,
        'message', 'Share created'
       );
end;
$$;