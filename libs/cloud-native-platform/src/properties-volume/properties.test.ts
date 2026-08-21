import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addFromAzureVault } from "./azure-vault.js";
import { getPropertiesVolumeSecrets } from "./properties.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock("./azure-vault.js", () => ({
  addFromAzureVault: vi.fn()
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockAddFromAzureVault = vi.mocked(addFromAzureVault);

function dirEntry(name: string, isDir: boolean, isSymlink = false) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir && !isSymlink, isSymbolicLink: () => isSymlink } as any;
}

function fileEntry(name: string, isSymlink = false) {
  return dirEntry(name, false, isSymlink);
}

function restoreEnv(original: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  Object.assign(process.env, original);
}

describe("getPropertiesVolumeSecrets", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    restoreEnv(originalEnv);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    restoreEnv(originalEnv);
  });

  it("should read vault subdirectories with prefixed keys", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(false); // no chartPath match
    mockExistsSync.mockReturnValue(true); // mount point exists
    mockReaddirSync.mockReturnValueOnce([dirEntry("pip-ss-kv", true)] as any);
    mockReaddirSync.mockReturnValueOnce([fileEntry("DATABASE_URL"), fileEntry("APP_SECRET")] as any);
    mockReadFileSync.mockReturnValueOnce("db-connection-string" as any).mockReturnValueOnce("my-secret" as any);

    // Act
    const secrets = await getPropertiesVolumeSecrets();

    // Assert
    expect(secrets["pip-ss-kv.DATABASE_URL"]).toBe("db-connection-string");
    expect(secrets["pip-ss-kv.APP_SECRET"]).toBe("my-secret");
  });

  it("should inject env vars when injectEnvVars is true (default)", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([dirEntry("vault", true)] as any);
    mockReaddirSync.mockReturnValueOnce([fileEntry("MY_SECRET")] as any);
    mockReadFileSync.mockReturnValue("secret-value" as any);

    // Act
    await getPropertiesVolumeSecrets();

    // Assert
    expect(process.env.MY_SECRET).toBe("secret-value");
  });

  it("should not inject env vars when injectEnvVars is false", async () => {
    // Arrange
    delete process.env.NO_INJECT_SECRET;
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([dirEntry("vault", true)] as any);
    mockReaddirSync.mockReturnValueOnce([fileEntry("NO_INJECT_SECRET")] as any);
    mockReadFileSync.mockReturnValue("secret-value" as any);

    // Act
    await getPropertiesVolumeSecrets({ injectEnvVars: false });

    // Assert
    expect(process.env.NO_INJECT_SECRET).toBeUndefined();
  });

  it("should read direct files without subdirectories", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([fileEntry("secret1"), fileEntry("secret2")] as any);
    mockReadFileSync.mockReturnValueOnce("value1" as any).mockReturnValueOnce("value2" as any);

    // Act
    const secrets = await getPropertiesVolumeSecrets();

    // Assert
    expect(secrets.secret1).toBe("value1");
    expect(secrets.secret2).toBe("value2");
  });

  it("should handle mixed vault dirs and direct files", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([dirEntry("my-vault", true), fileEntry("direct-file")] as any);
    mockReaddirSync.mockReturnValueOnce([fileEntry("VAULT_SECRET")] as any);
    mockReadFileSync.mockReturnValueOnce("vault-value" as any).mockReturnValueOnce("direct-value" as any);

    // Act
    const secrets = await getPropertiesVolumeSecrets();

    // Assert
    expect(secrets["my-vault.VAULT_SECRET"]).toBe("vault-value");
    expect(secrets["direct-file"]).toBe("direct-value");
  });

  it("should skip entries starting with '..' inside vault directories", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([dirEntry("vault", true)] as any);
    mockReaddirSync.mockReturnValueOnce([fileEntry("..hidden"), fileEntry("VISIBLE_SECRET")] as any);
    mockReadFileSync.mockReturnValue("value" as any);

    // Act
    const secrets = await getPropertiesVolumeSecrets();

    // Assert
    expect(secrets["vault...hidden"]).toBeUndefined();
    expect(secrets["vault.VISIBLE_SECRET"]).toBe("value");
  });

  it("should throw error when mount point does not exist and failOnError is true", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(false);

    // Act & Assert
    await expect(getPropertiesVolumeSecrets({ failOnError: true })).rejects.toThrow("Mount point /mnt/secrets does not exist");
  });

  it("should warn when mount point does not exist and failOnError is false", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(false);

    // Act
    const secrets = await getPropertiesVolumeSecrets({ failOnError: false });

    // Assert
    expect(consoleWarnSpy).toHaveBeenCalledWith("Warning: Mount point /mnt/secrets does not exist");
    expect(secrets).toEqual({});
  });

  it("should handle file read errors when failOnError is false", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([fileEntry("good"), fileEntry("bad")] as any);
    mockReadFileSync.mockReturnValueOnce("value" as any).mockImplementationOnce(() => {
      throw new Error("Permission denied");
    });

    // Act
    const secrets = await getPropertiesVolumeSecrets({ failOnError: false });

    // Assert
    expect(secrets.good).toBe("value");
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to process"));
  });

  it("should trim whitespace from file contents", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([fileEntry("secret")] as any);
    mockReadFileSync.mockReturnValue("  value with spaces  \n" as any);

    // Act
    const secrets = await getPropertiesVolumeSecrets();

    // Assert
    expect(secrets.secret).toBe("value with spaces");
  });

  it("should use custom mount point", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([fileEntry("custom-secret")] as any);
    mockReadFileSync.mockReturnValue("custom-value" as any);

    // Act
    const secrets = await getPropertiesVolumeSecrets({ mountPoint: "/custom/path" });

    // Assert
    expect(mockExistsSync).toHaveBeenCalledWith("/custom/path");
    expect(secrets["custom-secret"]).toBe("custom-value");
  });

  it("should handle symbolic links as files", async () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce([fileEntry("symlink-file", true)] as any);
    mockReadFileSync.mockReturnValue("symlink-value" as any);

    // Act
    const secrets = await getPropertiesVolumeSecrets();

    // Assert
    expect(secrets["symlink-file"]).toBe("symlink-value");
  });

  describe("Azure Vault integration", () => {
    it("should load secrets from Azure vault when chartPath is provided in non-production", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      mockExistsSync.mockReturnValue(true);
      mockAddFromAzureVault.mockImplementation(async (config) => {
        config.AZURE_SECRET = "azure-value";
      });

      // Act
      const secrets = await getPropertiesVolumeSecrets({ chartPath: "/path/to/chart.yaml" });

      // Assert
      expect(mockAddFromAzureVault).toHaveBeenCalled();
      expect(secrets.AZURE_SECRET).toBe("azure-value");
    });

    it("should not load from Azure vault in production", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValueOnce([] as any);

      // Act
      await getPropertiesVolumeSecrets({ chartPath: "/path/to/chart.yaml" });

      // Assert
      expect(mockAddFromAzureVault).not.toHaveBeenCalled();
    });

    it("should not load from Azure vault when chart file does not exist", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      // chartPath check returns false, mount point check returns true
      mockExistsSync.mockImplementation((path) => path !== "/nonexistent/chart.yaml");
      mockReaddirSync.mockReturnValueOnce([] as any);

      // Act
      await getPropertiesVolumeSecrets({ chartPath: "/nonexistent/chart.yaml" });

      // Assert
      expect(mockAddFromAzureVault).not.toHaveBeenCalled();
    });

    it("should apply omit filter to Azure vault secrets", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      mockExistsSync.mockReturnValue(true);
      mockAddFromAzureVault.mockImplementation(async (config) => {
        config.DATABASE_URL = "azure-db-url";
        config.APP_SECRET = "azure-app-secret";
      });

      // Act
      const secrets = await getPropertiesVolumeSecrets({
        chartPath: "/path/to/chart.yaml",
        omit: ["DATABASE_URL"]
      });

      // Assert
      expect(secrets.DATABASE_URL).toBeUndefined();
      expect(secrets.APP_SECRET).toBe("azure-app-secret");
    });

    it("should inject Azure vault secrets into process.env", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      delete process.env.AZURE_INJECTED;
      mockExistsSync.mockReturnValue(true);
      mockAddFromAzureVault.mockImplementation(async (config) => {
        config.AZURE_INJECTED = "injected-value";
      });

      // Act
      await getPropertiesVolumeSecrets({ chartPath: "/path/to/chart.yaml" });

      // Assert
      expect(process.env.AZURE_INJECTED).toBe("injected-value");
    });
  });

  describe("Error handling", () => {
    it("should default failOnError to true in production", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      mockExistsSync.mockReturnValue(false);

      // Act & Assert
      await expect(getPropertiesVolumeSecrets()).rejects.toThrow("Mount point /mnt/secrets does not exist");
    });

    it("should throw when existsSync throws and failOnError is true", async () => {
      // Arrange
      mockExistsSync.mockImplementation(() => {
        throw new Error("Unexpected fs error");
      });

      // Act & Assert
      await expect(getPropertiesVolumeSecrets({ failOnError: true })).rejects.toThrow("Unexpected fs error");
    });

    it("should throw when Azure vault fails and failOnError is true", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      mockExistsSync.mockReturnValue(true);
      mockAddFromAzureVault.mockRejectedValue(new Error("Azure auth failed"));

      // Act & Assert
      await expect(getPropertiesVolumeSecrets({ chartPath: "/path/to/chart.yaml", failOnError: true })).rejects.toThrow(
        "Failed to load secrets from Azure Vault: Error: Azure auth failed"
      );
    });

    it("should warn when Azure vault fails and failOnError is false", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      // First existsSync for chartPath returns true, second for mountPoint returns false
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockAddFromAzureVault.mockRejectedValue(new Error("Azure auth failed"));

      // Act
      const secrets = await getPropertiesVolumeSecrets({ chartPath: "/path/to/chart.yaml", failOnError: false });

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load secrets from Azure Vault"));
      expect(secrets).toEqual({});
    });

    it("should throw when reading directory fails and failOnError is true", async () => {
      // Arrange
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValueOnce([dirEntry("vault", true)] as any);
      mockReaddirSync.mockImplementationOnce(() => {
        throw new Error("Permission denied");
      });

      // Act & Assert
      await expect(getPropertiesVolumeSecrets({ failOnError: true })).rejects.toThrow("Failed to load secrets from /mnt/secrets");
    });

    it("should warn when reading directory file fails and failOnError is false", async () => {
      // Arrange
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValueOnce([dirEntry("vault", true)] as any);
      mockReaddirSync.mockReturnValueOnce([fileEntry("secret1"), fileEntry("secret2")] as any);
      mockReadFileSync.mockReturnValueOnce("value1" as any).mockImplementationOnce(() => {
        throw new Error("File read error");
      });

      // Act
      const secrets = await getPropertiesVolumeSecrets({ failOnError: false });

      // Assert
      expect(secrets["vault.secret1"]).toBe("value1");
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to read"));
    });

    it("should throw when reading directory file fails and failOnError is true", async () => {
      // Arrange
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValueOnce([dirEntry("vault", true)] as any);
      mockReaddirSync.mockReturnValueOnce([fileEntry("secret1")] as any);
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error("File read error");
      });

      // Act & Assert
      await expect(getPropertiesVolumeSecrets({ failOnError: true })).rejects.toThrow();
    });
  });

  describe("shouldOmit function edge cases", () => {
    it("should omit secrets by last part of key when key contains dots", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      mockExistsSync.mockReturnValue(true);
      mockAddFromAzureVault.mockImplementation(async (config) => {
        config["vault.DATABASE_URL"] = "db-url";
        config["vault.APP_SECRET"] = "secret";
      });

      // Act
      const secrets = await getPropertiesVolumeSecrets({
        chartPath: "/path/to/chart.yaml",
        omit: ["DATABASE_URL"]
      });

      // Assert
      expect(secrets["vault.DATABASE_URL"]).toBeUndefined();
      expect(secrets["vault.APP_SECRET"]).toBe("secret");
    });

    it("should not omit when omit array is empty", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      mockExistsSync.mockReturnValue(true);
      mockAddFromAzureVault.mockImplementation(async (config) => {
        config.DATABASE_URL = "db-url";
      });

      // Act
      const secrets = await getPropertiesVolumeSecrets({
        chartPath: "/path/to/chart.yaml",
        omit: []
      });

      // Assert
      expect(secrets.DATABASE_URL).toBe("db-url");
    });

    it("should skip non-string values from Azure vault", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      mockExistsSync.mockReturnValue(true);
      mockAddFromAzureVault.mockImplementation(async (config) => {
        config.STRING_VALUE = "string";
        config.NUMBER_VALUE = 123;
        config.OBJECT_VALUE = { nested: "value" };
      });

      // Act
      const secrets = await getPropertiesVolumeSecrets({ chartPath: "/path/to/chart.yaml" });

      // Assert
      expect(secrets.STRING_VALUE).toBe("string");
      expect(secrets.NUMBER_VALUE).toBeUndefined();
      expect(secrets.OBJECT_VALUE).toBeUndefined();
    });
  });

  describe("Alias mapping from helm chart in production filesystem path", () => {
    it("should use alias as env var name when secret name has a corresponding alias in the helm chart", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      delete process.env.REDIS_URL;
      const helmChart = `nodejs:\n  keyVaults:\n    cath:\n      secrets:\n        - name: redis-url\n          alias: REDIS_URL\n`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValueOnce(helmChart as any).mockReturnValueOnce("rediss://:key@host:6380" as any);
      mockReaddirSync.mockReturnValueOnce([dirEntry("cath", true)] as any);
      mockReaddirSync.mockReturnValueOnce([fileEntry("redis-url")] as any);

      // Act
      const secrets = await getPropertiesVolumeSecrets({ chartPath: "/app/helm/values.yaml" });

      // Assert - alias REDIS_URL is used as env var, not the raw file name redis-url
      expect(process.env.REDIS_URL).toBe("rediss://:key@host:6380");
      expect(process.env["redis-url"]).toBeUndefined();
      expect(secrets["cath.redis-url"]).toBe("rediss://:key@host:6380");
    });

    it("should fall back to file name as env var when no alias is defined in the helm chart", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      const helmChart = `nodejs:\n  keyVaults:\n    cath:\n      secrets:\n        - name: app-secret\n`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValueOnce(helmChart as any).mockReturnValueOnce("secret-value" as any);
      mockReaddirSync.mockReturnValueOnce([dirEntry("cath", true)] as any);
      mockReaddirSync.mockReturnValueOnce([fileEntry("app-secret")] as any);

      // Act
      await getPropertiesVolumeSecrets({ chartPath: "/app/helm/values.yaml" });

      // Assert - no alias, so raw file name is used
      expect(process.env["app-secret"]).toBe("secret-value");
    });
  });

  describe("Symbolic link handling in directories", () => {
    it("should handle symbolic links in vault directories", async () => {
      // Arrange
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValueOnce([dirEntry("vault", true)] as any);
      mockReaddirSync.mockReturnValueOnce([fileEntry("regular-file"), fileEntry("symlink-file", true)] as any);
      mockReadFileSync.mockReturnValueOnce("regular-value" as any).mockReturnValueOnce("symlink-value" as any);

      // Act
      const secrets = await getPropertiesVolumeSecrets();

      // Assert
      expect(secrets["vault.regular-file"]).toBe("regular-value");
      expect(secrets["vault.symlink-file"]).toBe("symlink-value");
    });
  });
});
