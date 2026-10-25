import type { Config } from "@netlify/functions";
import { coletarNoticias } from "../../lib/noticias.mts";

// Atualiza a aba de notícias todo dia às 12h de Brasília (15h UTC; Brasília não tem horário de verão).
export default async () => {
  const n = await coletarNoticias();
  console.log("Notícias ok", n.atualizadoEm, n.temas.map((t: any) => `${t.id}:${t.itens.length}`).join(" "));
};

export const config: Config = { schedule: "0 15 * * *" };
