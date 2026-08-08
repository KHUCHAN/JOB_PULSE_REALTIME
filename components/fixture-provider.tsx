"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { createFixtureRepository } from "../lib/fixture-repository";
import type { JobPulseRepository } from "../lib/repository";

export interface JobPulseContextValue {
  repository: JobPulseRepository;
  revision: number;
  demoMode: true;
  mutate<T>(operation: () => Promise<T>): Promise<T>;
}

const JobPulseContext = createContext<JobPulseContextValue | null>(null);

export function FixtureProvider({ children }: { children: ReactNode }): ReactElement {
  const repositoryRef = useRef<JobPulseRepository | null>(null);
  const [revision, setRevision] = useState(0);

  if (!repositoryRef.current) {
    repositoryRef.current = createFixtureRepository();
  }

  const mutate = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = await operation();
    setRevision((current) => current + 1);
    return result;
  }, []);

  return (
    <JobPulseContext.Provider
      value={{
        repository: repositoryRef.current,
        revision,
        demoMode: true,
        mutate,
      }}
    >
      {children}
    </JobPulseContext.Provider>
  );
}

export function useJobPulse(): JobPulseContextValue {
  const context = useContext(JobPulseContext);
  if (!context) {
    throw new Error("useJobPulse must be used inside FixtureProvider");
  }
  return context;
}
