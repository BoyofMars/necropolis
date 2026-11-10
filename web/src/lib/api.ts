import type { Eligibility } from "@/core/appraisal";
import type { Diagnosis } from "@/core/death";
import type { GraveJson, PlotJson } from "@/core/near";
import type { TokenDossier } from "@/core/vitals";
import type { ScanResult } from "@/server/dossier";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("You appear to be offline.", "OFFLINE", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, body.code ?? "HTTP", res.status);
  return body as T;
}

export const post = <T>(path: string, data: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(data) });

export interface TokenResponse {
  dossier: TokenDossier;
  diagnosis: Diagnosis;
  eligibility: Eligibility;
  plot: PlotJson | null;
  graves: GraveJson[];
}

export type { ScanResult };
