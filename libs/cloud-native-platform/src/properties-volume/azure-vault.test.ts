import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addFromAzureVault } from "./azure-vault.js";

// Create a shared mock client reference
const mockClient = {
  getSecret: vi.fn()
};

// Mock all external dependencies with proper factory functions
vi.mock("@azure/identity", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest 4 requires function keyword for constructors
  DefaultAzureCredential: vi.fn().mockImplementation(function () {
    return {};
  })
}));

vi.mock("@azure/keyvault-secrets", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest 4 requires function keyword for constructors
  SecretClient: vi.fn().mockImplementation(function () {
    return mockClient;
  })
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn()
}));

vi.mock("js-yaml", () => ({
  load: vi.fn()
}));

// Import mocked modules after vi.mock declarations
const { SecretClient } = await import("@azure/keyvault-secrets");
const { readFileSync } = await import("node:fs");
const { load: yamlLoad } = await import("js-yaml");

const mockSecretClient = vi.mocked(SecretClient);
const mockReadFileSync = vi.mocked(readFileSync);
const mockYamlLoad = vi.mocked(yamlLoad);

describe("addFromAzureVault", () => {
  let config: Record<string, any>;
  let consoleWarnSpy: any;

  beforeEach(() => {
    config = { existing: "value" };
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("should load secrets from Azure Key Vault", async () => {
    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["secret1", { name: "secret2", alias: "custom-alias" }]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValueOnce({ value: "secret-value-1" }).mockResolvedValueOnce({ value: "secret-value-2" });

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(mockReadFileSync).toHaveBeenCalledWith("/path/to/chart.yaml", "utf8");
    expect(mockYamlLoad).toHaveBeenCalledWith("helm-chart-content");
    expect(mockSecretClient).toHaveBeenCalledWith("https://test-vault-aat.vault.azure.net/", expect.any(Object));
    expect(mockClient.getSecret).toHaveBeenCalledWith("secret1");
    expect(mockClient.getSecret).toHaveBeenCalledWith("secret2");

    expect(config).toEqual({
      existing: "value",
      secret1: "secret-value-1",
      "custom-alias": "secret-value-2"
    });
  });

  it("should use custom vault URI suffix when provided", async () => {
    const helmChart = {
      keyVaults: {
        "my-app": {
          secrets: ["secret1"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValueOnce({ value: "secret-value" });

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml", vaultUriSuffix: "stg" });

    expect(mockSecretClient).toHaveBeenCalledWith("https://my-app-stg.vault.azure.net/", expect.any(Object));
  });

  it("should handle multiple vaults", async () => {
    const helmChart = {
      keyVaults: {
        vault1: {
          secrets: ["secret1"]
        },
        vault2: {
          secrets: ["secret2"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValueOnce({ value: "value1" }).mockResolvedValueOnce({ value: "value2" });

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(mockSecretClient).toHaveBeenCalledWith("https://vault1-aat.vault.azure.net/", expect.any(Object));
    expect(mockSecretClient).toHaveBeenCalledWith("https://vault2-aat.vault.azure.net/", expect.any(Object));

    expect(config).toEqual({
      existing: "value",
      secret1: "value1",
      secret2: "value2"
    });
  });

  it("should warn when no keyVaults found in Helm chart", async () => {
    const helmChart = { other: "config" };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(consoleWarnSpy).toHaveBeenCalledWith("Azure Vault: No keyVaults found in Helm chart");
    expect(config).toEqual({ existing: "value" });
  });

  it("should warn for invalid vault configuration", async () => {
    const helmChart = {
      keyVaults: {
        "valid-vault": { secrets: ["secret1"] },
        "incomplete-vault": {} // Missing secrets
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValue({ value: "value1" });

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(consoleWarnSpy).toHaveBeenCalledWith("Azure Vault: Invalid vault configuration for 'incomplete-vault', missing secrets");
    expect(config).toEqual({
      existing: "value",
      secret1: "value1"
    });
  });

  it("should throw error when secret retrieval fails", async () => {
    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["failing-secret"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockRejectedValue(new Error("Access denied"));

    await expect(addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" })).rejects.toThrow(
      "Azure Key Vault: Vault 'test-vault': Failed to retrieve secret failing-secret: Access denied"
    );
  });

  it("should provide cleaner error message for permission errors", async () => {
    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["redis-access-key"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    const permissionError: any = new Error("The user does not have secrets get permission");
    permissionError.statusCode = 403;
    mockClient.getSecret.mockRejectedValue(permissionError);

    await expect(addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" })).rejects.toThrow(
      "Azure Key Vault: Vault 'test-vault': Could not load secret 'redis-access-key'. Check it exists and you have access to it."
    );
  });

  it("should throw error when secret has no value", async () => {
    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["empty-secret"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValue({ value: null });

    await expect(addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" })).rejects.toThrow(
      "Azure Key Vault: Vault 'test-vault': Failed to retrieve secret empty-secret: Secret empty-secret has no value"
    );
  });

  it("should normalize secret names when no alias provided", async () => {
    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["secret-with-dashes", "secret.with.dots"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValueOnce({ value: "value1" }).mockResolvedValueOnce({ value: "value2" });

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(config).toEqual({
      existing: "value",
      secret_with_dashes: "value1",
      secret_with_dots: "value2"
    });
  });

  it("should handle deeply nested keyVaults in Helm chart", async () => {
    const helmChart = {
      global: {
        nested: {
          keyVaults: {
            "deep-vault": {
              secrets: ["deep-secret"]
            }
          }
        }
      },
      someOther: {
        keyVaults: {
          "other-vault": {
            secrets: ["other-secret"]
          }
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValueOnce({ value: "deep-value" }).mockResolvedValueOnce({ value: "other-value" });

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(mockSecretClient).toHaveBeenCalledWith("https://deep-vault-aat.vault.azure.net/", expect.any(Object));
    expect(mockSecretClient).toHaveBeenCalledWith("https://other-vault-aat.vault.azure.net/", expect.any(Object));
    expect(config).toEqual({
      existing: "value",
      deep_secret: "deep-value",
      other_secret: "other-value"
    });
  });

  it("should handle keyVaults that are not objects", async () => {
    const helmChart = {
      keyVaults: "not-an-object"
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(config).toEqual({ existing: "value" });
  });

  it("should throw error when YAML parsing fails", async () => {
    mockReadFileSync.mockReturnValue("invalid-yaml: {{{");
    mockYamlLoad.mockImplementation(() => {
      throw new Error("YAML parsing error");
    });

    await expect(addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" })).rejects.toThrow("Azure Key Vault: YAML parsing error");
  });

  it("should throw error when file reading fails", async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("File not found");
    });

    await expect(addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" })).rejects.toThrow("Azure Key Vault: File not found");
  });

  it("should handle vault config as simple string", async () => {
    const helmChart = {
      keyVaults: {
        "vault-name": "simple-string"
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(consoleWarnSpy).toHaveBeenCalledWith("Azure Vault: Invalid vault configuration for 'vault-name', missing secrets");
    expect(config).toEqual({ existing: "value" });
  });

  it("should merge secrets with deep nested config", async () => {
    config = {
      existing: "value",
      nested: {
        prop: "old"
      }
    };

    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["nested"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockResolvedValue({ value: "new-value" });

    await addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" });

    expect(config).toEqual({
      existing: "value",
      nested: "new-value"
    });
  });

  it("should handle errors with no message property", async () => {
    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["secret1"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    mockClient.getSecret.mockRejectedValue("String error");

    await expect(addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" })).rejects.toThrow(
      "Azure Key Vault: Vault 'test-vault': Failed to retrieve secret secret1: String error"
    );
  });

  it("should not duplicate vault name in error message if already present", async () => {
    const helmChart = {
      keyVaults: {
        "test-vault": {
          secrets: ["secret1"]
        }
      }
    };

    mockReadFileSync.mockReturnValue("helm-chart-content");
    mockYamlLoad.mockReturnValue(helmChart);
    const error = new Error("test-vault: Already contains vault name");
    mockClient.getSecret.mockRejectedValue(error);

    await expect(addFromAzureVault(config, { pathToHelmChart: "/path/to/chart.yaml" })).rejects.toThrow(
      "Azure Key Vault: Failed to retrieve secret secret1: test-vault: Already contains vault name"
    );
  });
});
