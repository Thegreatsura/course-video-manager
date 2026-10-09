# shellcheck shell=bash
# Sourced by verify.sh. The Tiny Course: the one Course an agent may Publish
# (or Export, or hand any other encode Job) on a clone.
#
# A real Course from the template is dozens of Videos of dozens of Clips each,
# and a Publish encodes every one of them: that once took the machine to the
# edge of its memory. `tiny-course <run>` makes a Course of one Section, one
# Lesson, one Video and one Clip of a few seconds of generated test footage,
# in this run's clone only, and prints its id and its publish page.

# Seconds of generated footage, and the Clip cut from it. The export pads the
# last Clip, so the source runs past the Clip's end.
TINY_SOURCE_SECONDS=5
TINY_CLIP_START=0.5
TINY_CLIP_END=3.0
TINY_COURSE_NAME='Verify Tiny Course'
# Its own application_name, so the Write Ledger names the seed apart from
# the server and the sidecar.
TINY_COURSE_APP=cvm-verify-tiny-course

tiny_uuid() { cat /proc/sys/kernel/random/uuid; }

cmd_tiny_course() {
  local dir; dir="$(run_dir)"
  [ "$(run_mode "$dir")" = test-clone ] ||
    die "tiny-course seeds a test clone only — this run is on PRODUCTION, where nothing is ever Published"
  command -v ffmpeg > /dev/null || die "tiny-course needs ffmpeg on PATH to make its footage"

  # The footage lives in the run's scratch, like every other file a run makes.
  local media="$dir/scratch/tiny-course" source
  mkdir -p "$media"
  source="$media/source.mp4"
  if [ ! -s "$source" ]; then
    ffmpeg -nostdin -hide_banner -loglevel error -y \
      -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=$TINY_SOURCE_SECONDS" \
      -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$TINY_SOURCE_SECONDS" \
      -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest "$source" ||
      die "ffmpeg could not make the Tiny Course's footage at $source"
  fi

  local course version section lesson video clip
  course="$(tiny_uuid)"; version="$(tiny_uuid)"; section="$(tiny_uuid)"
  lesson="$(tiny_uuid)"; video="$(tiny_uuid)"; clip="$(tiny_uuid)"

  # One transaction: a Course with one Draft Version that ships in full — the
  # Video has a Clip, a body, a description and a Chapter, so Publish
  # readiness is clean and Autofill has nothing to do. A dud Dropbox token goes
  # in too when the clone has none: it reaches only the discard port or your
  # loopback stub.
  psql_clone_write "$dir" "$TINY_COURSE_APP" \
    -v course="$course" -v version="$version" -v section="$section" \
    -v lesson="$lesson" -v video="$video" -v clip="$clip" \
    -v name="$TINY_COURSE_NAME" -v source="$source" \
    -v clip_start="$TINY_CLIP_START" -v clip_end="$TINY_CLIP_END" <<'SQL' ||
begin;
insert into "course-video-manager_course" (id, name)
  values (:'course', :'name');
insert into "course-video-manager_course_version" (id, course_id, name, commit_state)
  values (:'version', :'course', '', 'draft');
insert into "course-video-manager_section" (id, lineage_id, course_version_id, title, "order")
  values (:'section', gen_random_uuid(), :'version', 'Tiny Section', 1);
insert into "course-video-manager_lesson" (id, lineage_id, section_id, title, "order")
  values (:'lesson', gen_random_uuid(), :'section', 'Tiny Lesson', 1);
insert into "course-video-manager_video" (id, lineage_id, lesson_id, title, original_footage_path, body, video_description)
  values (:'video', gen_random_uuid(), :'lesson', 'Explainer', :'source',
          'A few seconds of generated test footage, for verify-cvm.',
          'The Tiny Course: one Video, one Clip, a few seconds long.');
insert into "course-video-manager_clip" (id, video_id, video_filename, source_start_time, source_end_time, "order", text)
  values (:'clip', :'video', :'source', :clip_start, :clip_end, 'a1', 'Tiny Course test tone.');
insert into "course-video-manager_chapter" (id, video_id, name, "order")
  values (gen_random_uuid(), :'video', 'Test tone', 'a0');  -- before the Clip's a1: the Video opens with a Chapter
insert into "course-video-manager_dropbox_auth" (id, access_token, refresh_token, expires_at)
  select 'verify-tiny-course', 'verify-dud-access', 'verify-dud-refresh', now() + interval '30 days'
  where not exists (select 1 from "course-video-manager_dropbox_auth");
commit;
SQL
    die "could not seed the Tiny Course into $(run_clone_name "$dir")"

  echo "$course" > "$dir/tiny-course.id"
  log "tiny-course: seeded '$TINY_COURSE_NAME' into $(run_clone_name "$dir") — 1 Video, 1 Clip of $(awk "BEGIN{print $TINY_CLIP_END-$TINY_CLIP_START}")s"
  log "  footage:  $source"
  log "  publish:  $(run_base)/courses/$course/publish"
  log "  course id alone on stdout, and in $dir/tiny-course.id"
  echo "$course"
}
