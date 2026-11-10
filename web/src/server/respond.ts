import { NextResponse } from "next/server";
import { TokenIdentityError } from "@/core/chains";
import { BurialError } from "./burial";
import { ProviderError } from "./http";
import { SextonConfigError } from "./sexton";

export function ok<T>(data: T, cacheSeconds = 0) {
  return NextResponse.json(data, {
    headers: cacheSeconds > 0 ? { "cache-control": `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}` } : { "cache-control": "no-store" },
  });
}

/** Map internal errors to user-recoverable messages. */
export function fail(e: unknown) {
  if (e instanceof TokenIdentityError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
  if (e instanceof BurialError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof SextonConfigError)
    return NextResponse.json({ error: "This deployment is read-only right now (relayer not configured).", code: "READ_ONLY" }, { status: 503 });
  if (e instanceof ProviderError) {
    const rate = e.status === 429;
    return NextResponse.json(
      {
        error: rate
          ? `${e.provider} is rate limiting us. Try again in a minute.`
          : `${e.provider} is not responding right now. Try again shortly.`,
        code: rate ? "RATE_LIMITED" : "PROVIDER_DOWN",
      },
      { status: rate ? 429 : 502 },
    );
  }
  console.error(e);
  return NextResponse.json({ error: "Something went wrong on our side.", code: "INTERNAL" }, { status: 500 });
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new BurialError("Malformed request.", "BAD_REQUEST");
  }
}
