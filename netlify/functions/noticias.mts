import type { Config } from "@netlify/functions";
import { lerNoticias } from "../../lib/noticias.mts";

export default async () => {
  const n = await lerNoticias();
  if (!n) return Response.json({ erro: "Notícias indisponíveis agora." }, { status: 503 });
  return Response.json(n, { headers: { "cache-control": "public, max-age=300" } });
};

export const config: Config = { path: "/api/noticias", method: "GET" };
