import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { resolveDropboxUrl } from "./dropbox-http-client";

// A verification run points both Dropbox hosts at a local stub (verify-cvm
// sets them to a dead port unless the caller exports a loopback URL), so no
// Publish on a clone can reach the real Dropbox.
describe("resolveDropboxUrl", () => {
  it.effect("keeps Dropbox's own hosts when nothing is set", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveDropboxUrl(
          "https://api.dropboxapi.com/2/files/list_folder"
        )
      ).toBe("https://api.dropboxapi.com/2/files/list_folder");
      expect(
        yield* resolveDropboxUrl(
          "https://content.dropboxapi.com/2/files/upload"
        )
      ).toBe("https://content.dropboxapi.com/2/files/upload");
    }).pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map())))
  );

  it.effect("sends each host where its variable says", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveDropboxUrl(
          "https://api.dropboxapi.com/2/files/list_folder"
        )
      ).toBe("http://127.0.0.1:18790/2/files/list_folder");
      expect(
        yield* resolveDropboxUrl(
          "https://content.dropboxapi.com/2/files/upload_session/start"
        )
      ).toBe("http://127.0.0.1:18791/2/files/upload_session/start");
    }).pipe(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(
          new Map([
            ["DROPBOX_API_URL", "http://127.0.0.1:18790/"],
            ["DROPBOX_CONTENT_URL", "http://127.0.0.1:18791"],
          ])
        )
      )
    )
  );
});
