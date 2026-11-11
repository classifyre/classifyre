import {
  queryEngineMemory,
  queryEngineThreads,
} from './kubernetes-cli-job.service';

describe('DuckDB budget of a query job', () => {
  it('gives DuckDB 70 % of the pod memory', () => {
    expect(queryEngineMemory('2Gi')).toBe('1503MB');
    expect(queryEngineMemory('4G')).toBe('2800MB');
    expect(queryEngineMemory('512Mi')).toBe('375MB');
    expect(queryEngineMemory(undefined)).toBeNull();
    expect(queryEngineMemory('lots')).toBeNull();
  });

  it('uses whole cores, at least one', () => {
    expect(queryEngineThreads('1')).toBe(1);
    expect(queryEngineThreads('2500m')).toBe(2);
    expect(queryEngineThreads('250m')).toBe(1);
    expect(queryEngineThreads(undefined)).toBeNull();
  });
});
