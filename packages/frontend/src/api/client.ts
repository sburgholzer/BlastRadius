import type {
  AnalysisResult,
  AnalysisStatus,
  ApiError,
  SubmitAnalysisRequest,
  SubmitAnalysisResponse,
  SupportedFormat,
} from './types';

let _apiBaseUrlPromise: Promise<string> | undefined;

function getApiBaseUrl(): Promise<string> {
  if (!_apiBaseUrlPromise) {
    _apiBaseUrlPromise = resolveApiBaseUrl();
  }
  return _apiBaseUrlPromise;
}

async function resolveApiBaseUrl(): Promise<string> {
  // 1. Vite env var (local dev / build-time override)
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  // 2. Runtime config (deployed via CDK — /config.json in S3)
  try {
    const response = await fetch('/config.json');
    if (response.ok) {
      const config = await response.json();
      if (config.apiBaseUrl) {
        return config.apiBaseUrl as string;
      }
    }
  } catch {
    // Config not available — fall back to default
  }

  // 3. Fallback — same-origin /api path
  return '/api';
}

class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly apiError?: ApiError;

  constructor(message: string, statusCode: number, apiError?: ApiError) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.apiError = apiError;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let apiError: ApiError | undefined;
    try {
      apiError = await response.json();
    } catch {
      // Response body is not JSON
    }
    throw new ApiClientError(
      apiError?.message || `Request failed with status ${response.status}`,
      response.status,
      apiError,
    );
  }
  return response.json() as Promise<T>;
}

/**
 * API client for communicating with the Blast Radius backend.
 * Handles all REST API calls to the analysis service.
 */
export const apiClient = {
  /**
   * Submit a new analysis request.
   */
  async submitAnalysis(
    request: SubmitAnalysisRequest,
  ): Promise<SubmitAnalysisResponse> {
    const baseUrl = await getApiBaseUrl();
    const response = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return handleResponse<SubmitAnalysisResponse>(response);
  },

  /**
   * Get analysis status and results by ID.
   */
  async getAnalysis(analysisId: string): Promise<AnalysisResult> {
    const baseUrl = await getApiBaseUrl();
    const response = await fetch(`${baseUrl}/analyze/${analysisId}`);
    return handleResponse<AnalysisResult>(response);
  },

  /**
   * List all analyses (status records).
   */
  async listAnalyses(): Promise<AnalysisStatus[]> {
    const baseUrl = await getApiBaseUrl();
    const response = await fetch(`${baseUrl}/analyses`);
    return handleResponse<AnalysisStatus[]>(response);
  },

  /**
   * Export analysis results in the specified format.
   */
  async exportAnalysis(
    analysisId: string,
    format: 'json' | 'pdf',
  ): Promise<Blob> {
    const baseUrl = await getApiBaseUrl();
    const response = await fetch(
      `${baseUrl}/analyze/${analysisId}/export?format=${format}`,
    );
    if (!response.ok) {
      let apiError: ApiError | undefined;
      try {
        apiError = await response.json();
      } catch {
        // Response body is not JSON
      }
      throw new ApiClientError(
        apiError?.message || `Export failed with status ${response.status}`,
        response.status,
        apiError,
      );
    }
    return response.blob();
  },

  /**
   * Get list of supported changeset formats.
   */
  async getFormats(): Promise<SupportedFormat[]> {
    const baseUrl = await getApiBaseUrl();
    const response = await fetch(`${baseUrl}/formats`);
    return handleResponse<SupportedFormat[]>(response);
  },

  /**
   * Poll analysis status until completion or failure.
   * Returns the final result when analysis is no longer running.
   */
  async pollAnalysis(
    analysisId: string,
    intervalMs = 2000,
    timeoutMs = 180000,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.getAnalysis(analysisId);
      if (result.status !== 'running') {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new ApiClientError('Analysis polling timed out', 408);
  },
};

export { ApiClientError };
