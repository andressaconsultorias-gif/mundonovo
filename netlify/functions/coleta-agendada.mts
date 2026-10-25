import type { Config } from "@netlify/functions";
import { coletar } from "../../lib/coleta.mts";

// Coleta automática a cada 15 minutos, de segunda a sexta, das 10h às 23h45 UTC
// (7h às 20h45 em Brasília, que não tem horário de verão) — cobre o pregão de NY e da B3
// e a publicação do Indicador CEPEA no fim da tarde.
export default async () => {
  const r = await coletar();
  console.log("Coleta ok", r.geradoEm, JSON.stringify(r.fontes));
};

export const config: Config = { schedule: "*/15 10-23 * * 1-5" };
