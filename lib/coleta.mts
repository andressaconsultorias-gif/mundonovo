import { getStore } from "@netlify/blobs";
import { parseCotacoes, parseHistorico } from "./parse.mts";

const NA = "https://www.noticiasagricolas.com.br/cotacoes/cafe";
const UA = "Mozilla/5.0 (compatible; MundoNovoPainel/1.0; painel interno de mercado)";

async function getText(url: string, ms = 9000) {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}`);
  return r.text();
}
async function getJSON(url: string, ms = 9000) {
  return JSON.parse(await getText(url, ms));
}

// ---------- Fontes ----------

async function fonteCotacoes() {
  return parseCotacoes(await getText(NA, 12000));
}

async function fonteDolar() {
  const j = await getJSON("https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL");
  const u = j.USDBRL, e = j.EURBRL;
  return {
    usd: { valor: +u.bid, var: +u.pctChange, max: +u.high, min: +u.low, hora: u.create_date },
    eur: e ? { valor: +e.bid, var: +e.pctChange } : null,
  };
}

async function fonteBCB() {
  const sgs = (cod: number, n: number) =>
    getJSON(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cod}/dados/ultimos/${n}?formato=json`);
  const [ptax, selic, ipca] = await Promise.allSettled([sgs(1, 60), sgs(432, 1), sgs(13522, 1)]);
  const br = (d: string) => d.split("/").reverse().join("-");
  return {
    ptax: ptax.status === "fulfilled" ? ptax.value.map((x: any) => ({ data: br(x.data), valor: parseFloat(x.valor) })) : [],
    selic: selic.status === "fulfilled" ? { data: br(selic.value[0].data), valor: parseFloat(selic.value[0].valor) } : null,
    ipca12m: ipca.status === "fulfilled" ? { data: br(ipca.value[0].data), valor: parseFloat(ipca.value[0].valor) } : null,
  };
}

const CIDADES = [
  { nome: "Patrocínio", regiao: "Cerrado Mineiro", lat: -18.944, lon: -46.993 },
  { nome: "São Sebastião do Paraíso", regiao: "Sudoeste de Minas", lat: -20.917, lon: -46.991 },
];

async function fonteClima() {
  const lat = CIDADES.map((c) => c.lat).join(",");
  const lon = CIDADES.map((c) => c.lon).join(",");
  const j = await getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min` +
      `&current=temperature_2m,relative_humidity_2m,precipitation` +
      `&past_days=7&forecast_days=8&timezone=America%2FSao_Paulo`
  );
  const arr = Array.isArray(j) ? j : [j];
  return arr.map((d: any, i: number) => ({
    ...CIDADES[i],
    agora: d.current ? { temp: d.current.temperature_2m, umidade: d.current.relative_humidity_2m, chuva: d.current.precipitation } : null,
    dias: d.daily.time.map((t: string, k: number) => ({
      data: t,
      chuva: d.daily.precipitation_sum[k],
      prob: d.daily.precipitation_probability_max?.[k] ?? null,
      max: d.daily.temperature_2m_max[k],
      min: d.daily.temperature_2m_min[k],
    })),
  }));
}

async function fonteCOT() {
  const j = await getJSON(
    "https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=083731" +
      "&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=26" +
      "&$select=report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all,comm_positions_long_all,comm_positions_short_all"
  );
  return j
    .map((r: any) => {
      const l = +r.noncomm_positions_long_all, s = +r.noncomm_positions_short_all;
      return {
        data: r.report_date_as_yyyy_mm_dd.slice(0, 10),
        fundosComprados: l,
        fundosVendidos: s,
        liquido: l - s,
        comerciaisLiquido: +r.comm_positions_long_all - +r.comm_positions_short_all,
        contratosEmAberto: +r.open_interest_all,
      };
    })
    .reverse();
}

async function fonteHistoricos() {
  const [a, r, n] = await Promise.allSettled([
    getText(`${NA}/indicador-cepea-esalq-cafe-arabica`),
    getText(`${NA}/indicador-cepea-esalq-cafe-conillon`),
    getText(`${NA}/cafe-bolsa-de-nova-iorque-nybot`),
  ]);
  return {
    arabica: a.status === "fulfilled" ? parseHistorico(a.value, "indicador") : {},
    robusta: r.status === "fulfilled" ? parseHistorico(r.value, "indicador") : {},
    ny: n.status === "fulfilled" ? parseHistorico(n.value, "contrato") : {},
  };
}

// ---------- Orquestração ----------

type Hist = Record<string, Record<string, number>>;

function poe(h: Hist, serie: string, data: string | null | undefined, valor: number | null | undefined) {
  if (!data || valor == null || !Number.isFinite(valor)) return;
  (h[serie] ??= {})[data] = valor;
}
function apara(h: Hist, max = 400) {
  for (const k of Object.keys(h)) {
    const datas = Object.keys(h[k]).sort();
    for (const d of datas.slice(0, Math.max(0, datas.length - max))) delete h[k][d];
  }
}

export async function coletar() {
  const store = getStore({ name: "mercado", consistency: "strong" });
  const anterior: any = (await store.get("atual", { type: "json" })) ?? {};
  const hist: Hist & { _seed?: any } = ((await store.get("historico", { type: "json" })) as any) ?? {};

  const precisaSemente = !hist._seed || Date.now() - Date.parse(hist._seed) > 6 * 3600e3;

  const nomes = ["cotacoes", "dolar", "bcb", "clima", "cot"] as const;
  const fontes = [fonteCotacoes(), fonteDolar(), fonteBCB(), fonteClima(), fonteCOT()];
  if (precisaSemente) fontes.push(fonteHistoricos() as any);
  const res = await Promise.allSettled(fontes);

  const agora = new Date().toISOString();
  const atual: any = { geradoEm: agora, fontes: {} };
  nomes.forEach((n, i) => {
    const r = res[i];
    if (r.status === "fulfilled") {
      atual[n] = r.value;
      atual.fontes[n] = { ok: true, em: agora };
    } else {
      atual[n] = anterior[n] ?? null; // mantém o último valor bom
      atual.fontes[n] = { ok: false, em: anterior.fontes?.[n]?.em ?? null, erro: String(r.reason?.message ?? r.reason).slice(0, 160) };
    }
  });

  // Semente de histórico (10 pregões de cada página)
  if (precisaSemente && res[5]?.status === "fulfilled") {
    const s: any = (res[5] as PromiseFulfilledResult<any>).value;
    for (const [d, v] of Object.entries<any>(s.arabica)) poe(hist, "arabica", d, v.valor);
    for (const [d, v] of Object.entries<any>(s.robusta)) poe(hist, "robusta", d, v.valor);
    for (const [d, v] of Object.entries<any>(s.ny)) { poe(hist, "nyCents", d, v.valor); poe(hist, "nyRS", d, v.rs); }
    hist._seed = agora;
  }

  // Valores do dia → histórico próprio (cresce a cada pregão)
  const c = atual.cotacoes;
  if (c) {
    poe(hist, "arabica", c.cepeaArabica?.data, c.cepeaArabica?.valor);
    poe(hist, "robusta", c.cepeaRobusta?.data, c.cepeaRobusta?.valor);
    poe(hist, "nyCents", c.ny?.data, c.ny?.contratos?.[0]?.preco);
    poe(hist, "nyRS", c.ny?.data, c.ny?.contratos?.[0]?.rs);
    poe(hist, "londres", c.londres?.data, c.londres?.contratos?.[0]?.preco);
    poe(hist, "b3", c.b3?.data, c.b3?.contratos?.[0]?.preco);
    const pat = c.fisico?.tipo6?.find((p: any) => /Patroc/i.test(p.local));
    poe(hist, "patrocinio", c.fisico?.data, pat?.preco);
  }
  for (const p of atual.bcb?.ptax ?? []) poe(hist, "ptax", p.data, p.valor);
  apara(hist);

  atual.historico = Object.fromEntries(Object.entries(hist).filter(([k]) => !k.startsWith("_")));

  await Promise.all([store.setJSON("atual", atual), store.setJSON("historico", hist)]);
  return atual;
}

export async function lerOuColetar(maxIdadeMin = 20) {
  const store = getStore({ name: "mercado", consistency: "strong" });
  const atual: any = await store.get("atual", { type: "json" });
  if (atual && Date.now() - Date.parse(atual.geradoEm) < maxIdadeMin * 60e3) return atual;
  try {
    return await coletar();
  } catch (e) {
    if (atual) return { ...atual, aviso: "Usando a última leitura salva." };
    throw e;
  }
}
