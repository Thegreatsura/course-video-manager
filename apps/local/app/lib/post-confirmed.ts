/**
 * POST `fields` as form data to a route action and resolve only once it
 * answered 2xx with `{ ok: true }`; reject otherwise. For a save that
 * something irreversible waits on, such as removing local images after an
 * Apply: a `fetcher.submit` resolves whether the action succeeded or not.
 */
export async function postConfirmed(
  action: string,
  fields: Record<string, string>
): Promise<void> {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }
  const response = await fetch(action, { method: "POST", body: formData });
  if (!response.ok) throw new Error(`Save failed: HTTP ${response.status}`);
  const answer: unknown = await response.json().catch(() => null);
  if ((answer as { ok?: unknown } | null)?.ok !== true) {
    throw new Error("Save failed: the action did not confirm it");
  }
}
