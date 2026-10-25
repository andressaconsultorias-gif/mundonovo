import { getStore } from "@netlify/blobs";
import { decode } from "./parse.mts";

// Notícias do mercado de café, agrupadas por tema.
// Fonte: buscas do Google Notícias (RSS) em português — reúne manchetes de vários veículos
// (Notícias Agrícolas, Globo Rural, Canal Rural, Valor, Reuters, CaféPoint etc.).
// Guardamos só título, veículo, data e link; o texto fica no site de origem.

export const TEMAS = [
  { id: "mercado", nome: "Mercado e preços", q: '"café arábica" OR "café conilon" OR "preço do café" OR "cotação do café" OR "mercado de café" OR "café robusta"' },
  { id: "safra", nome: "Safra e clima", q: '"safra de café" OR "florada do café" OR "colheita de café" OR cafeicultura OR cafeicultores OR "lavouras de café"' },
  { id: "exportacao", nome: "Exportação e demanda", q: '"exportações de café" OR "exportação de café" OR Cecafé OR "consumo de café" OR Abic OR "embarques de café"' },
  { id: "sustentabilidade", nome: "Sustentabilidade e certificação", q: '(café OR cafeicultura) (EUDR OR "Rainforest Alliance" OR certificação OR rastreabilidade OR regenerativo OR sustentável OR desmatamento)' },
  { id: "internacional", nome: "Internacional", q: 'café (Vietnã OR Colômbia OR Etiópia OR Honduras OR Indonésia OR OIC OR "bolsa de Nova York" OR Londres) (safra OR produção OR exportação OR preços)' },
] as const;

// A manchete precisa falar de café como mercado/cultura; descarta assuntos de consumo e gastronomia.
const RELEVANTE = /caf[ée]|cafeic|cafeeir|conilon|robusta|ar[áa]bica|EUDR|Cec[aá]f[ée]/i;
const RUIDO = /calorias|futebol|carrinho|empreendedor come[çc]a|novela|famos|caf[ée] da manh[ãa]|cafeteria|barista|receita|bolo|caf[ée] com leite|cafezinho|xícara|torrefação artesanal|"oscar"|caf[ée] da tarde|happy hour|horóscopo/i;
// …e precisa ter um termo de mercado, produção ou certificação (evita matérias de saúde, gastronomia, celebridades).
const NEGOCIO = /pre[çc]o|cota[çc][ãa]o|bolsa|saca|mercado|safra|colheita|florada|export|import|embarque|produ[çc][ãa]o|produtor|cafeicult|lavoura|ar[áa]bica|conilon|robusta|Cec[aá]f[ée]|Conab|EUDR|certifica|sustent|rastreab|regenerativ|desmatamento|Nova York|Londres|B3|fundos|estoque|oferta|demanda|tarifa|clima|chuva|geada|seca|El Ni[ñn]o|cooperativa|Cooxup|Expocaccer|Rainforest|OIC|Vietn|Col[ôo]mbia|Abic|consumo de caf/i;
// Termos obrigatórios por tema, para a manchete realmente ser daquele assunto.
const EXIGE: Record<string, RegExp> = {
  sustentabilidade: /EUDR|certific|sustent|rastreab|regenerativ|desmat|Rainforest|ambient|carbono|\b4C\b|org[âa]nic|ESG|socioambient|clim[áa]tic/i,
  internacional: /Vietn|Col[ôo]mbia|Eti[óo]pia|Honduras|Indon[ée]sia|Uganda|Peru|OIC|Europ|Estados Unidos|EUA|China|Jap[ãa]o|Alemanha|tarifa|internacion|Londres|global|mundial/i,
  exportacao: /export|import|embarque|Cec[aá]f[ée]|consumo|demanda|Abic|vendas|compradores|ind[úu]stria/i,
  safra: /safra|florada|colheita|lavoura|cafeicult|produtor|produ[çc][ãa]o|clima|chuva|geada|seca|El Ni[ñn]o|Conab|Embrapa|plantio/i,
};
export const relevante = (titulo: string) => RELEVANTE.test(titulo) && NEGOCIO.test(titulo) && !RUIDO.test(titulo);

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
      .filter((n) => (!n.data || Date.parse(n.data) >= limite) && relevante(n.titulo) && (!EXIGE[id] || EXIGE[id].test(n.titulo)))
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
  if (!Object.values(porTema).some((l) => l?.length) && anterior?.temas?.some((t: any) => t.itens.length)) return anterior;

  const dados = {
    versao: 4,
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
  if (n && n.versao === 4 && Date.now() - Date.parse(n.atualizadoEm) < 30 * 3600e3) return n;
  try { return await coletarNoticias(); } catch { return n ?? null; }
}
