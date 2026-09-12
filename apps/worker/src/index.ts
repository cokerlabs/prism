export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const BASE_PATH = "/in/prism";
const API_PATH = `${BASE_PATH}/api`;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (path === `${API_PATH}/health`) {
    return json({ ok: true, service: "prism" });
  }

  if (path === API_PATH || path.startsWith(`${API_PATH}/`)) {
    return json({ error: "not_found", service: "prism" }, 404);
  }

  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }
    return env.ASSETS.fetch(
      new Request(new URL(`${BASE_PATH}/index.html`, url.origin)),
    );
  }

  return text("Not found. Prism is at /in/prism/.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
