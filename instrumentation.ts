export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logDbConnection } = await import("./lib/db");
  // Not awaited: an unreachable DB must not delay server startup.
  void logDbConnection();
}
