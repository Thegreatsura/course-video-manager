# Research: Cloudinary Image Upload for AI Hero Posts

## Reference Implementation (AI Hero CLI)

The AI Hero CLI at `~/repos/ai/ai-hero-cli` has an existing `upload-to-cloudinary` command that serves as the reference implementation.

**File:** `src/internal/upload-to-cloudinary.ts`

### How It Works

1. Reads `CLOUDINARY_URL` from a `.env` file
2. Parses the URL format: `cloudinary://<api-key>:<api-secret>@<cloud-name>`
3. Configures the `cloudinary` npm package (v2 API) with extracted credentials
4. Scans markdown files for image references using regex: `!\[([^\]]*)\]\(([^)]+)\)`
5. For each image reference:
   - Skips URLs (starts with `http`)
   - Resolves absolute paths (starts with `/`) from the working directory
   - Resolves relative paths from the markdown file's directory
   - Uploads via `cloudinary.uploader.upload(path, { resource_type: "auto", folder: "ai-hero-images" })`
   - Replaces the markdown reference with `![alt](uploadResult.secure_url)`
6. Writes updated content back to the file

### Key Dependencies

- `cloudinary` npm package (^2.7.0) - uses `v2` import
- `dotenv` for env file loading
- Effect for error handling and async flow

### Error Types

- `CloudinaryUrlNotSetError` - env var missing
- `CouldNotParseCloudinaryUrlError` - URL format invalid
- `ImageUploadError` - upload failed

### Cloudinary URL Format

```
cloudinary://<api-key>:<api-secret>@<cloud-name>
```

Parsed with regex: `/cloudinary:\/\/([^:]+):([^:]+)@([^:]+)/`

### Upload Configuration

```typescript
cloudinary.uploader.upload(resolvedImagePath, {
  resource_type: "auto",
  folder: "ai-hero-images",
});
```

Returns an object with `secure_url` (HTTPS CDN URL).

---

## Current State of AI Hero Post Page

### Page Structure

**Route:** `app/routes/videos.$videoId.ai-hero.tsx`

- Left panel (1/4): `VideoContextPanel` with file tree, transcript, links
- Right panel (3/4): Post form with Title, Slug, Body (markdown textarea), SEO Description, and Post button

### File Tree & File Storage

**Standalone videos:**

- Files stored in `{STANDALONE_VIDEO_FILES_DIR}/{videoId}/{filename}`
- Default dir: `./standalone-video-files`
- Files listed by reading the directory, paths are just filenames (e.g., `screenshot.png`)

**Lesson-connected videos:**

- Files read from the lesson directory on disk: `{repo.filePath}/{section.path}/{lesson.path}/`
- Paths are relative to the lesson root (e.g., `src/App.tsx`, `images/diagram.png`)

### Body Text Flow

The body markdown is sent **unprocessed** to the AI Hero API:

1. User types in textarea → stored in localStorage
2. On "Post to AI Hero" → body sent via SSE to `/api/videos/:videoId/post-ai-hero`
3. Server sends body directly to AI Hero API PUT endpoint

There is **no existing file reference resolution** in the body text.

### Relevant File Metadata Type

```typescript
type FileMetadata = {
  path: string; // relative path (filename for standalone, relative path for lesson)
  size: number;
  defaultEnabled: boolean;
};
```

---

## Architecture Notes

### Image Path Resolution

When a user writes `![diagram](diagram.png)` in the markdown body:

- For **standalone** videos: resolve to `{STANDALONE_VIDEO_FILES_DIR}/{videoId}/diagram.png`
- For **lesson** videos: resolve to `{repo.filePath}/{section.path}/{lesson.path}/diagram.png`

This matches how the file tree already resolves paths in the loader.

### Server-Side Upload Required

Cloudinary upload requires API credentials (key + secret), so the upload **must** happen server-side. The flow is:

1. Client sends body text + video context to a new API endpoint
2. Server parses markdown for local image references
3. Server resolves each reference to an absolute file path on disk
4. Server uploads each file to Cloudinary
5. Server returns the updated body with Cloudinary URLs
6. Client updates the body textarea with the new content
