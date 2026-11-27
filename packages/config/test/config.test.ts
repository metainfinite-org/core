import { describe, expect, it } from "vitest";
import { ConfigError, parseDeploymentConfig } from "@ev/config";

describe("deployment.yml", () => {
  it("applies defaults", () => {
    expect(parseDeploymentConfig("")).toEqual({ name: "local", firstIdentity: 1n, blockIntervalMs: 1000, signIn: "dev", storage: "memory", features: { configApps: true } });
  });

  it("reads the public-demo style config, with big ids as strings", () => {
    const c = parseDeploymentConfig('name: public\nfirst_identity: "1000001"\nsign_in: oidc\nstorage: postgres\n');
    expect(c.firstIdentity).toBe(1_000_001n);
    expect(c.storage).toBe("postgres");
  });

  it("rejects unknown keys and bad values", () => {
    expect(() => parseDeploymentConfig("first_identiy: 5")).toThrow(ConfigError);
    expect(() => parseDeploymentConfig("first_identity: 0")).toThrow(ConfigError);
    expect(() => parseDeploymentConfig("first_identity: 1.5")).toThrow(ConfigError);
    expect(() => parseDeploymentConfig("storage: mongo")).toThrow(ConfigError);
    expect(() => parseDeploymentConfig("features: { config_app: false }")).toThrow(ConfigError);
    expect(() => parseDeploymentConfig("features: { config_apps: no-thanks }")).toThrow(ConfigError);
  });

  it("reads feature switches for parked code", () => {
    expect(parseDeploymentConfig("features:\n  config_apps: false\n").features.configApps).toBe(false);
  });
});
