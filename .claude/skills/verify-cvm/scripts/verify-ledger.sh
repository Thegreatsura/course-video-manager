# Sourced by verify.sh: the two exact halves of the Write Ledger. Uses
# verify.sh's log and die, and verify-db.sh's psql_ro.
# shellcheck shell=bash
#
# Why not pg_stat_user_tables: Postgres's cumulative stats are flushed by each
# backend only every so often (at most once a second, and an idle backend can
# hold its counts for ~10s or more), so a write the app made a moment ago can
# be missing from them. A Ledger built on them once said "clean" over a real
# UI save. A Ledger that can falsely say "clean" is worse than none, so:
#
#   test clone   statement-level triggers on every table of the clone record
#                each committed write into verify_ledger.write, in the same
#                transaction as the write. Exact, immediate, committed-only.
#   both modes   the app logs every statement it sends ("[cvm-sql]" lines in
#                server.log, CVM_LOG_SQL=1). On production — where the server's
#                connections are read-only and nothing may be written to find
#                out — that log is what proves this run sent no write.

# --- the clone's write ledger: triggers -------------------------------------
LEDGER_SCHEMA=verify_ledger

# Who wrote. launch gives the run's server and its sidecar each their own
# PGAPPNAME, and the trigger records the writing session's application_name, so
# the Ledger tells the two apart by connection, never by table: the server
# writes job and job_event rows too (an Export it enqueues, a Job it dismisses).
# Anything else (a seed or script of the agent.s own) is a third writer.
LEDGER_APP_SERVER=cvm-verify-server
LEDGER_APP_SIDECAR=cvm-verify-sidecar

# install_write_ledger <clone url> — once, at launch, before the server starts.
install_write_ledger() {
  psql -X -q -v ON_ERROR_STOP=1 "$1" <<'SQL'
begin;
create schema verify_ledger;
create table verify_ledger.write (
  xid        xid8        not null default pg_current_xact_id(),
  at         timestamptz not null default clock_timestamp(),
  table_name text        not null,
  op         text        not null,
  rows       bigint,               -- null for TRUNCATE
  app        text        not null default coalesce(current_setting('application_name', true), '')
);
create function verify_ledger.record() returns trigger language plpgsql as $$
declare n bigint;
begin
  if TG_OP = 'DELETE' then select count(*) into n from old_rows;
  elsif TG_OP = 'TRUNCATE' then n := null;
  else select count(*) into n from new_rows;
  end if;
  if n is null or n > 0 then
    insert into verify_ledger.write (table_name, op, rows) values (
      case when TG_TABLE_SCHEMA = 'public' then TG_TABLE_NAME
           else TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME end,
      TG_OP, n);
  end if;
  return null;
end $$;
do $$
declare r record;
begin
  for r in select c.oid::regclass as rel
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p') and not c.relispartition
              and n.nspname not in ('information_schema', 'verify_ledger')
              and n.nspname not like 'pg\_%'
  loop
    execute format('create trigger verify_ledger_ins after insert on %s referencing new table as new_rows for each statement execute function verify_ledger.record()', r.rel);
    execute format('create trigger verify_ledger_upd after update on %s referencing new table as new_rows for each statement execute function verify_ledger.record()', r.rel);
    execute format('create trigger verify_ledger_del after delete on %s referencing old table as old_rows for each statement execute function verify_ledger.record()', r.rel);
    execute format('create trigger verify_ledger_trn after truncate on %s for each statement execute function verify_ledger.record()', r.rel);
  end loop;
end $$;
commit;
SQL
}

# ledger_uncovered <run dir> — tables the triggers do not cover (created after
# launch, or a trigger disabled). Their writes would be invisible: UNKNOWN.
ledger_uncovered() {
  psql_ro "$1" -c "select c.oid::regclass
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relispartition
       and n.nspname not in ('information_schema', '$LEDGER_SCHEMA')
       and n.nspname not like 'pg\_%'
       and (select count(*) from pg_trigger t
             where t.tgrelid = c.oid and t.tgname like 'verify\_ledger\_%'
               and t.tgenabled in ('O', 'A')) < 4
     order by 1"
}

ledger_installed() {
  [ "$(psql_ro "$1" -c "select to_regclass('$LEDGER_SCHEMA.write') is not null")" = t ]
}

# ledger_snapshot <run dir> — every transaction visible now is "before the window".
ledger_snapshot() { psql_ro "$1" -c "select pg_current_snapshot()"; }

# ledger_in_flight <run dir> — other sessions holding an uncommitted write right
# now. Read BEFORE ledger_writes: the window closes at this moment.
ledger_in_flight() {
  psql_ro "$1" -c "select count(*) from pg_stat_activity
     where datname = current_database() and backend_xid is not null
       and pid <> pg_backend_pid()"
}

# ledger_attributes <run dir> — does this clone's ledger record the writer?
# One installed by an older verify.sh does not, and could not split the
# server's writes from the sidecar's.
ledger_attributes() {
  [ "$(psql_ro "$1" -c "select count(*) from information_schema.columns
     where table_schema = '$LEDGER_SCHEMA' and table_name = 'write' and column_name = 'app'")" = 1 ]
}

# ledger_writes <run dir> <baseline snapshot> —
# "writer|table|ins|upd|del|truncates" for every write committed by a
# transaction the baseline could not see. writer is server, sidecar, or
# other:<application_name> (other:? when the session set none).
ledger_writes() {
  psql_ro "$1" -c "select case app when '$LEDGER_APP_SERVER' then 'server'
                              when '$LEDGER_APP_SIDECAR' then 'sidecar'
                              else 'other:' || coalesce(nullif(app, ''), '?') end as writer,
           table_name,
           coalesce(sum(rows) filter (where op = 'INSERT'), 0),
           coalesce(sum(rows) filter (where op = 'UPDATE'), 0),
           coalesce(sum(rows) filter (where op = 'DELETE'), 0),
           count(*) filter (where op = 'TRUNCATE')
      from $LEDGER_SCHEMA.write
     where not pg_visible_in_snapshot(xid, '$2'::pg_snapshot)
     group by 1, table_name order by 1, table_name"
}

# --- the app's statement log ------------------------------------------------
SQL_LOG_PREFIX='[cvm-sql] '

# sql_log_offset <run dir> — bytes of server.log so far; baseline records it.
sql_log_offset() { wc -c < "$1/server.log" 2>/dev/null || echo 0; }

# sql_log_active <run dir> — has the server written ANY statement line yet?
# A server that never did is not logging (CVM_LOG_SQL unset, or a checkout
# from before the log existed), and its silence proves nothing.
sql_log_active() { grep -qF "$SQL_LOG_PREFIX" "$1/server.log" 2>/dev/null; }

# sql_window <run dir> <from offset> — statements sent since the baseline.
sql_window() {
  tail -c +"$(( $2 + 1 ))" "$1/server.log" 2>/dev/null |
    sed -e 's/\x1b\[[0-9;]*m//g' | grep -aF "$SQL_LOG_PREFIX" |
    sed -e "s/^.*\[cvm-sql\] //" || true
}

# Conservative on purpose: a statement that might write counts as one.
SQL_WRITE_RE='^[[:space:](]*(insert|update|delete|merge|truncate|copy|create|alter|drop|grant|revoke|comment|lock|refresh|reindex|vacuum|cluster|call|do)\b|^[[:space:](]*with\b.*\b(insert|update|delete|merge)\b'
# Anything that could lift the read-only guard off a production connection.
SQL_OVERRIDE_RE='read[[:space:]]+write|transaction_read_only|session_replication_role|set[[:space:]]+(session[[:space:]]+)?role|session_authorization'

sql_writes()    { grep -aiE "$SQL_WRITE_RE" || true; }

# sql_write_tables — the table each write statement on stdin names, one per
# line ("?" for a statement whose table it cannot read, e.g. a CTE).
sql_write_tables() {
  sed -E -n -e 's/^[[:space:](]*(insert[[:space:]]+into|update|delete[[:space:]]+from|truncate([[:space:]]+table)?)[[:space:]]+"?([A-Za-z0-9_.-]+)"?.*/\3/Ip; t' -e 's/.*/?/p'
}
sql_overrides() { grep -aiE "$SQL_OVERRIDE_RE" || true; }

# Statements Postgres refused because the connection was read-only.
read_only_rejections() {
  tail -c +"$(( $2 + 1 ))" "$1/server.log" 2>/dev/null |
    grep -acE 'read-only transaction|PreventCommandIfReadOnly|25006' || true
}
