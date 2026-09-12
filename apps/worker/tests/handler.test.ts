import { describe, expect, it } from "vitest";
import { handleRequest, type Env } from "../src/index";

function envWithAssets(
  handler: (request: Request) => Response | Promise<Response>,
): Env {
  return {
    DB: {} as Env["DB"],
    ASSETS: {
      fetch: handler,
    } as Env["ASSETS"],
  };
}

describe("worker routing", () => {
  it("returns the health stub under /in/prism/api/health", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/in/prism/api/health"),
      envWithAssets(() => new Response("unused")),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "prism" });
  });

  it("does not serve a public root page", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/"),
      envWithAssets(() => new Response("<html>app</html>")),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("/in/prism/");
  });

  it("falls back to the /in/prism/ shell for unknown app paths", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/in/prism/compose"),
      envWithAssets((request) => {
        const path = new URL(request.url).pathname;
        if (path === "/in/prism/index.html") {
          return new Response("<html>prism</html>", {
            headers: { "content-type": "text/html" },
          });
        }
        return new Response("missing", { status: 404 });
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("prism");
  });
});
