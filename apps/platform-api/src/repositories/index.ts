import { config } from "../config.js";
import type { PlatformRepository } from "./platform-repository.js";

const loadPlatformRepository = async (): Promise<PlatformRepository> => {
  if (config.dbDriver === "postgres") {
    const { postgresPlatformRepository } = await import("./postgres-platform-repository.js");
    return postgresPlatformRepository;
  }

  if (config.isProduction) {
    throw new Error("SQLite repository is not allowed in production");
  }

  const { sqlitePlatformRepository } = await import("./sqlite-platform-repository.js");
  return sqlitePlatformRepository;
};

export const platformRepository = await loadPlatformRepository();
