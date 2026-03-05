import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { ArchiveRestore } from "lucide-react";
import { useState } from "react";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/archived-plans";

export const meta: Route.MetaFunction = () => {
  return [
    {
      title: "CVM - Archived Plans",
    },
  ];
};

export const loader = async (_args: Route.LoaderArgs) => {
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const archivedPlans = yield* db.getArchivedPlans();
    const repos = yield* db.getRepos();
    const standaloneVideos = yield* db.getStandaloneVideos();
    const plans = yield* db.getPlans();

    return {
      archivedPlans,
      repos,
      standaloneVideos,
      plans,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    runtimeLive.runPromise
  );
};

export default function ArchivedPlans(props: Route.ComponentProps) {
  const unarchivePlanFetcher = useFetcher();
  const data = props.loaderData;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedRepoId = searchParams.get("repoId");
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [isAddStandaloneVideoModalOpen, setIsAddStandaloneVideoModalOpen] =
    useState(false);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar
        repos={data.repos}
        standaloneVideos={data.standaloneVideos}
        selectedRepoId={selectedRepoId}
        isAddRepoModalOpen={isAddRepoModalOpen}
        setIsAddRepoModalOpen={setIsAddRepoModalOpen}
        isAddStandaloneVideoModalOpen={isAddStandaloneVideoModalOpen}
        setIsAddStandaloneVideoModalOpen={setIsAddStandaloneVideoModalOpen}
        plans={data.plans}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Archived Plans</h1>

          {data.archivedPlans.length === 0 ? (
            <p className="text-muted-foreground">No archived plans.</p>
          ) : (
            <div className="space-y-2">
              {data.archivedPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <Button
                      variant="link"
                      className="h-auto p-0 font-medium text-base"
                      onMouseDown={() => {
                        navigate(`/plans/${plan.id}`, {
                          preventScrollReset: true,
                        });
                      }}
                    >
                      {plan.title}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      unarchivePlanFetcher.submit(
                        { archived: "false" },
                        {
                          method: "post",
                          action: `/api/plans/${plan.id}/archive`,
                        }
                      );
                    }}
                    disabled={unarchivePlanFetcher.state !== "idle"}
                  >
                    <ArchiveRestore className="w-4 h-4 mr-2" />
                    Unarchive
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
