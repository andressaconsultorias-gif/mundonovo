import { getStore } from "@netlify/blobs";
import { decode } from "./parse.mts";

// Notícias do mercado de café, agrupadas por tema.
// Fonte: buscas do Google Notícias (RSS) em português — reúne manchetes de vários veículos
// (Notícias Agrícolas, Globo Rural, Canal Rural, Valor, Reuters, CaféPoint etc.).
// Guardamos só título, veículo, data e link; o texto fica no site de origem.

export const TEMAS = [
  { id: "mercado", nome: "Mercado e preços", q: 'café (arábica OR conilon OR robusta) (preço OR cotação OR bolsa OR "Nova York")' },
  { id: "safra", nome: "Safra e clima", q: "café (safra OR florada OR colheita OR Conab OR chuva OR geada OR \"El Niño\")" },
  { id: "exportacao", nome: "Exportação e demanda", q: "café (exportação OR exportações OR Cecafé OR embarques OR torrefação OR consumo)" },
  { id: "sustentabilidade", nome: "Sustentabilidade e certificação", q: "café (EUDR OR desmatamento OR \"Rainforest Alliance\" OR certificação OR rastreabilidade OR regenerativo)" },
  { id: "internacional", nome: "Internacional", q: "café (Vietnã OR Colômbia OR ICE OR \"OIC\" OR tarifa OR \"Estados Unidos\" OR Europa) mercado" },
] as const;

export type Noticia = { titulo: string; veiculo: string | null; url: string; data: string | null; tema: string };

const tag = (xml: string, t: string) => {
  const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"));
  return m ? decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
};

export function parseRSS(xml: string, tema: string): Noticia[] {
  const out: Noticia[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    let titulo = tag(it, "title") ?? "";
    const veiculo = tag(it, "source");
    if (veiculo && titulo.endsWith(" - " + veiculo)) titulo = titulo.slice(0, -(veiculo.length + 3));
    const url = tag(it, "link");
    const pub = tag(it, "pubDate");
    const d = pub ? new Date(pub) : null;
    if (!titulo || !url) continue;
    out.push({ titulo, veiculo, url, data: d && !isNaN(+d) ? d.toISOString() : null, tema });
  }
  return out;
}

const chave = (t: string) => t.toLowerCase().normalize("NFD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").slice(0, 70);

export async function coletarNoticias() {
  const res = await Promise.allSettled(
    TEMAS.map(async (t) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(t.q + " when:7d")}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; MundoNovoPainel/1.0)" }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Google Notícias respondeu ${r.status}`);
      return parseRSS(await r.text(), t.id);
    })
  );

  const vistos = new Set<string>();
  const porTema: Record<string, Noticia[]> = {};
  const erros: string[] = [];
  const limite = Date.now() - 7 * 864e5;
  res.forEach((r, i) => {
    const id = TEMAS[i].id;
    if (r.status !== "fulfilled") { erros.push(id); return; }
    porTema[id] = r.value
      .filter((n) => !n.data || Date.parse(n.data) >= limite)
      .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""))
      .filter((n) => { const k = chave(n.titulo); if (vistos.has(k)) return false; vistos.add(k); return true; })
      .slice(0, 12);
  });

  const store = getStore({ name: "mercado", consistency: "strong" });
  const anterior: any = await store.get("noticias", { type: "json" });
  // tema que falhou mantém as manchetes da última coleta boa
  for (const id of erros) if (anterior?.temas) {
    const velho = anterior.temas.find((t: any) => t.id === id);
    if (velho) porTema[id] = velho.itens;
  }
  if (!Object.values(porTema).some((l) => l?.length) && anterior) return anterior;

  const dados = {
    atualizadoEm: new Date().toISOString(),
    temas: TEMAS.map((t) => ({ id: t.id, nome: t.nome, itens: porTema[t.id] ?? [] })),
    falhas: erros,
  };
  await store.setJSON("noticias", dados);
  return dados;
}

/** Lê as notícias salvas; se não houver nenhuma ainda (primeiro acesso), coleta na hora. */
export async function lerNoticias() {
  const store = getStore({ name: "mercado", consistency: "strong" });
  const n: any = await store.get("noticias", { type: "json" });
  if (n && Date.now() - Date.parse(n.atualizadoEm) < 30 * 3600e3) return n;
  try { return await coletarNoticias(); } catch { return n ?? null; }
}
