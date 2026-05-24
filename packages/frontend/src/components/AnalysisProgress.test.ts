import { describe, it, expect } from 'vitest';
import { ApiClientError } from '../api';
import type { AnalysisResult } from '../api/types';
import { formatElapsedTime, getStageLabel, getErrorMessage } from './AnalysisProgress';

describe('AnalysisProgress logic', () => {
  describe('formatElapsedTime', () => {
    it('formats milliseconds below 1 second', () => {
      expect(formatElapsedTime(500)).toBe('500ms');
      expect(formatElapsedTime(0)).toBe('0ms');
      expect(formatElapsedTime(999)).toBe('999ms');
    });

    it('formats seconds below 1 minute', () => {
      expect(formatElapsedTime(1000)).toBe('1s');
      expect(formatElapsedTime(5000)).toBe('5s');
      expect(formatElapsedTime(59000)).toBe('59s');
    });

    it('formats minutes and seconds', () => {
      expect(formatElapsedTime(60000)).toBe('1m 0s');
      expect(formatElapsedTime(90000)).toBe('1m 30s');
      expect(formatElapsedTime(125000)).toBe('2m 5s');
    });
  });

  describe('getStageLabel', () => {
    it('returns user-friendly label for known stages', () => {
      expect(getStageLabel('Ingestion')).toBe('Validating manifest');
      expect(getStageLabel('AdapterConversion')).toBe('Converting changeset format');
      expect(getStageLabel('Discovery')).toBe('Discovering dependencies');
      expect(getStageLabel('Scoring')).toBe('Computing risk scores');
      expect(getStageLabel('VisualizationPrep')).toBe('Preparing visualization');
      expect(getStageLabel('SummaryGeneration')).toBe('Generating risk summary');
      expect(getStageLabel('Complete')).toBe('Analysis complete');
    });

    it('returns the raw stage name for unknown stages', () => {
      expect(getStageLabel('UnknownStage')).toBe('UnknownStage');
      expect(getStageLabel('CustomStep')).toBe('CustomStep');
    });
  });

  describe('getErrorMessage', () => {
    it('returns validation error message from result errorDetails', () => {
      const result: AnalysisResult = {
        analysisId: 'test-123',
        status: 'failed',
        requestingPrincipal: 'arn:aws:iam::123:user/test',
        originatingAccountId: '123456789012',
        sourceFormat: 'canonical',
        submittedAt: '2024-01-01T00:00:00Z',
        errorDetails: {
          stage: 'Ingestion',
          errorCategory: 'VALIDATION_ERROR',
          message: 'Missing required field: resourceType',
        },
      };
      const msg = getErrorMessage(result);
      expect(msg).toContain('Validation failed');
      expect(msg).toContain('Validating manifest');
      expect(msg).toContain('Missing required field: resourceType');
    });

    it('returns permission denied message', () => {
      const result: AnalysisResult = {
        analysisId: 'test-123',
        status: 'failed',
        requestingPrincipal: 'arn:aws:iam::123:user/test',
        originatingAccountId: '123456789012',
        sourceFormat: 'canonical',
        submittedAt: '2024-01-01T00:00:00Z',
        errorDetails: {
          stage: 'Discovery',
          errorCategory: 'PERMISSION_DENIED',
          message: 'Insufficient permissions',
        },
      };
      const msg = getErrorMessage(result);
      expect(msg).toContain('Permission denied');
      expect(msg).toContain('Discovering dependencies');
      expect(msg).toContain('IAM permissions');
    });

    it('returns resource not found message', () => {
      const result: AnalysisResult = {
        analysisId: 'test-123',
        status: 'failed',
        requestingPrincipal: 'arn:aws:iam::123:user/test',
        originatingAccountId: '123456789012',
        sourceFormat: 'canonical',
        submittedAt: '2024-01-01T00:00:00Z',
        errorDetails: {
          stage: 'Scoring',
          errorCategory: 'RESOURCE_NOT_FOUND',
          message: 'Resource sg-abc not found',
        },
      };
      const msg = getErrorMessage(result);
      expect(msg).toContain('not found');
      expect(msg).toContain('Computing risk scores');
    });

    it('returns throttling message', () => {
      const result: AnalysisResult = {
        analysisId: 'test-123',
        status: 'failed',
        requestingPrincipal: 'arn:aws:iam::123:user/test',
        originatingAccountId: '123456789012',
        sourceFormat: 'canonical',
        submittedAt: '2024-01-01T00:00:00Z',
        errorDetails: {
          stage: 'Discovery',
          errorCategory: 'SERVICE_THROTTLING',
          message: 'Rate exceeded',
        },
      };
      const msg = getErrorMessage(result);
      expect(msg).toContain('rate limit');
      expect(msg).toContain('Discovering dependencies');
    });

    it('returns timeout message from errorDetails', () => {
      const result: AnalysisResult = {
        analysisId: 'test-123',
        status: 'failed',
        requestingPrincipal: 'arn:aws:iam::123:user/test',
        originatingAccountId: '123456789012',
        sourceFormat: 'canonical',
        submittedAt: '2024-01-01T00:00:00Z',
        errorDetails: {
          stage: 'Discovery',
          errorCategory: 'TIMEOUT',
          message: 'Execution timed out',
        },
      };
      const msg = getErrorMessage(result);
      expect(msg).toContain('timed out');
      expect(msg).toContain('Discovering dependencies');
    });

    it('returns generic failure message for unknown error category', () => {
      const result: AnalysisResult = {
        analysisId: 'test-123',
        status: 'failed',
        requestingPrincipal: 'arn:aws:iam::123:user/test',
        originatingAccountId: '123456789012',
        sourceFormat: 'canonical',
        submittedAt: '2024-01-01T00:00:00Z',
        errorDetails: {
          stage: 'Scoring',
          errorCategory: 'INTERNAL_ERROR',
          message: 'Something went wrong',
        },
      };
      const msg = getErrorMessage(result);
      expect(msg).toContain('failed');
      expect(msg).toContain('Something went wrong');
    });

    it('returns timeout message for ApiClientError with 408 status', () => {
      const error = new ApiClientError('Timeout', 408);
      const msg = getErrorMessage(undefined, error);
      expect(msg).toContain('timed out');
    });

    it('returns access denied message for ApiClientError with 403 status', () => {
      const error = new ApiClientError('Forbidden', 403);
      const msg = getErrorMessage(undefined, error);
      expect(msg).toContain('Access denied');
    });

    it('returns generic ApiClientError message for other status codes', () => {
      const error = new ApiClientError('Server error', 500);
      const msg = getErrorMessage(undefined, error);
      expect(msg).toContain('Request failed');
      expect(msg).toContain('Server error');
    });

    it('returns message from generic Error', () => {
      const error = new Error('Network failure');
      const msg = getErrorMessage(undefined, error);
      expect(msg).toContain('unexpected error');
      expect(msg).toContain('Network failure');
    });

    it('returns fallback message for unknown error type', () => {
      const msg = getErrorMessage(undefined, 'some string error');
      expect(msg).toContain('unexpected error');
      expect(msg).toContain('try again');
    });

    it('returns fallback message when no result or error provided', () => {
      const msg = getErrorMessage(undefined, undefined);
      expect(msg).toContain('unexpected error');
    });
  });
});
