import type { Config } from "@netlify/functions";
import { lerOuColetar } from "../../lib/coleta.mts";

// Entrega o retrato mais recente do mercado para o painel.
// Se a última coleta tiver mais de 20 minutos (fim de semana, primeira visita), coleta na hora.
export default async () => {
  try {
    const dados = await lerOuColetar(20);
    return Response.json(dados, { headers: { "cache-control": "public, max-age=60" } });
  } catch (e: any) {
    return Response.json({ erro: "Não foi possível ler os dados agora.", detalhe: String(e?.message ?? e) }, { status: 503 });
  }
};

export const config: Config = { path: "/api/dados", method: "GET" };
