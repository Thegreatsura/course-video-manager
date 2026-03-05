import { Button } from "@/components/ui/button";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { generateChangelog } from "@/services/changelog-service";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { ArrowLeft } from "lucide-react";
import Markdown from "react-markdown";
import { data, Link, useNavigate } from "react-router";
import type { Route } from "./+types/repos.$repoId.changelog";

export const loader = async (args: Route.LoaderArgs) => {
  const { repoId } = args.params;

  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;

    const repo = yield* db.getRepoById(repoId);
    const versions = yield* db.getAllVersionsWithStructure(repoId);
    const changelog = generateChangelog(versions);

    return {
      repo,
      changelog,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Repo not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const { repo, changelog } = props.loaderData;
  const navigate = useNavigate();

  useFocusRevalidate({ enabled: true });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6">
          <Link
            to={`/?repoId=${repo.id}`}
            onClick={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              if (e.button === 0) navigate(`/?repoId=${repo.id}`);
            }}
          >
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {repo.name}
            </Button>
          </Link>
        </div>

        <div className="prose prose-invert max-w-none">
          <Markdown>{changelog}</Markdown>
        </div>
      </div>
    </div>
  );
}
