import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authMiddleware } from "@/middlewares/auth.middleware";

const HUB_API = "https://hub.docker.com/v2";
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  status: number;
  body: unknown;
}

const cache = new Map<string, CacheEntry>();

function isValidNamePart(part: string): boolean {
  return /^[a-z0-9_][a-z0-9_.-]{0,127}$/i.test(part);
}

async function fetchHub(path: string): Promise<{ status: number; body: unknown }> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return { status: cached.status, body: cached.body };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${HUB_API}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const body = res.status === 404 ? null : await res.json().catch(() => null);
    const entry = { expiresAt: Date.now() + CACHE_TTL_MS, status: res.status, body };
    cache.set(path, entry);
    // Bound cache size (simple FIFO eviction).
    if (cache.size > 500) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function imageRoutes(app: FastifyInstance) {
  app.register(async (fastify) => {
    fastify.addHook("preHandler", authMiddleware);

    /**
     * Verify a Docker Hub repository exists + show metadata for the picker.
     * GET /api/v1/images/:namespace/:repo
     */
    fastify.get(
      "/api/v1/images/:namespace/:repo",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { namespace, repo } = request.params as {
          namespace: string;
          repo: string;
        };
        if (!isValidNamePart(namespace) || !isValidNamePart(repo)) {
          return reply.status(400).send({
            error: "VALIDATION_ERROR",
            message: "Invalid namespace or repository name",
          });
        }
        try {
          const { status, body } = await fetchHub(
            `/namespaces/${namespace}/repositories/${repo}`
          );
          if (status === 404 || body == null) {
            return reply.status(404).send({
              error: "IMAGE_NOT_FOUND",
              message: `${namespace}/${repo} not found on Docker Hub`,
            });
          }
          if (status !== 200) {
            return reply.status(502).send({
              error: "HUB_UNAVAILABLE",
              message: "Docker Hub lookup failed, try again",
            });
          }
          const info = body as any;
          return reply.send({
            name: info.name,
            namespace: info.namespace,
            description: info.description ?? "",
            starCount: info.star_count ?? 0,
            pullCount: info.pull_count ?? 0,
            isOfficial: namespace === "library",
            lastUpdated: info.last_updated ?? null,
          });
        } catch (error) {
          request.log.error({ error }, "Docker Hub repo lookup failed");
          return reply.status(502).send({
            error: "HUB_UNAVAILABLE",
            message: "Docker Hub lookup failed, try again",
          });
        }
      }
    );

    /**
     * List tags for a repository (most recently updated first).
     * GET /api/v1/images/:namespace/:repo/tags
     */
    fastify.get(
      "/api/v1/images/:namespace/:repo/tags",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { namespace, repo } = request.params as {
          namespace: string;
          repo: string;
        };
        if (!isValidNamePart(namespace) || !isValidNamePart(repo)) {
          return reply.status(400).send({
            error: "VALIDATION_ERROR",
            message: "Invalid namespace or repository name",
          });
        }
        try {
          const { status, body } = await fetchHub(
            `/namespaces/${namespace}/repositories/${repo}/tags?page_size=25&ordering=-last_updated`
          );
          if (status === 404 || body == null) {
            return reply.status(404).send({
              error: "IMAGE_NOT_FOUND",
              message: `${namespace}/${repo} not found on Docker Hub`,
            });
          }
          if (status !== 200) {
            return reply.status(502).send({
              error: "HUB_UNAVAILABLE",
              message: "Docker Hub tag lookup failed, try again",
            });
          }
          const results = (body as any).results ?? [];
          return reply.send({
            tags: results.map((t: any) => ({
              name: t.name,
              digest: t.digest ?? null,
              lastUpdated: t.last_updated ?? null,
            })),
          });
        } catch (error) {
          request.log.error({ error }, "Docker Hub tag lookup failed");
          return reply.status(502).send({
            error: "HUB_UNAVAILABLE",
            message: "Docker Hub tag lookup failed, try again",
          });
        }
      }
    );
  });
}
