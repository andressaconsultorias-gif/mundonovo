// Leitura das páginas de cotação do Notícias Agrícolas.
// O HTML é convertido em uma sequência simples de títulos, linhas de tabela e textos,
// para não depender de nomes de classes que o site pode mudar.

export type Item = { t: "h"; text: string } | { t: "row"; cells: string[] } | { t: "txt"; text: string };
export type Section = { title: string; items: Item[] };

const ENT: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ordm: "º", ordf: "ª", deg: "°",
  aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó",
  uacute: "ú", Uacute: "Ú", atilde: "ã", Atilde: "Ã", otilde: "õ", Otilde: "Õ", ccedil: "ç", Ccedil: "Ç",
  acirc: "â", Acirc: "Â", ecirc: "ê", Ecirc: "Ê", ocirc: "ô", Ocirc: "Ô", agrave: "à", Agrave: "À",
};

export function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
}

const clean = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Número no formato brasileiro ("1.601,95", "-1,11%", "+1,81") → 1601.95 */
export function num(s: unknown): number | null {
  if (s == null) return null;
  const t = String(s).replace(/[^\d,.\-+]/g, "");
  if (!/\d/.test(t)) return null;
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "23/10/2026" → "2026-10-23" */
export function isoDate(s: string): string | null {
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function toItems(html: string): Item[] {
  const body = html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // Converte o HTML num fluxo de linhas marcadas: §H = título, §R = linha de tabela (células separadas por §C).
  const flat = body
    .replace(/\s+/g, " ")
    // cada linha de tabela vira uma linha única, mesmo que as células tenham <div>/<br> por dentro
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, inner: string) => {
      const cells: string[] = [];
      const cre = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c: RegExpExecArray | null;
      while ((c = cre.exec(inner))) cells.push(c[1].replace(/<[^>]+>/g, " ").replace(/[§\n]/g, " "));
      return "\n§R" + cells.map((x) => "§C" + x).join("") + "\n";
    })
    .replace(/<h[1-6][^>]*>/gi, "\n§H ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/table>|<\/p>|<\/div>|<\/li>|<br\s*\/?>|<\/caption>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const items: Item[] = [];
  for (const raw of decode(flat).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("§H")) {
      const text = line.slice(2).replace(/\s+/g, " ").trim();
      if (text) items.push({ t: "h", text });
    } else if (line.startsWith("§R")) {
      const cells = line.slice(2).split("§C").slice(1).map((c) => c.replace(/\s+/g, " ").trim());
      if (cells.some(Boolean)) items.push({ t: "row", cells });
    } else {
      items.push({ t: "txt", text: line.replace(/§C/g, " ").replace(/\s+/g, " ") });
    }
  }
  return items;
}

export function sections(items: Item[]): Section[] {
  const out: Section[] = [];
  let cur: Section = { title: "", items: [] };
  for (const it of items) {
    if (it.t === "h") {
      out.push(cur);
      cur = { title: it.text, items: [] };
    } else cur.items.push(it);
  }
  out.push(cur);
  return out;
}

const rows = (s?: Section) => (s ? s.items.filter((i): i is { t: "row"; cells: string[] } => i.t === "row").map((i) => i.cells) : []);

function atualizado(s?: Section): string | null {
  if (!s) return null;
  for (const i of s.items) {
    const text = i.t === "row" ? i.cells.join(" ") : i.text;
    const m = text.match(/Atualizado em:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (m) return isoDate(m[1]);
  }
  return null;
}

function find(secs: Section[], re: RegExp, not?: RegExp) {
  return secs.find((s) => re.test(s.title) && !(not && not.test(s.title)));
}

export type Indicador = { data: string; valor: number; var: number | null };
export type Contrato = { mes: string; preco: number; rs?: number | null; var: number | null };
export type Praca = { local: string; preco: number; var: number | null };

function indicador(s?: Section): Indicador | null {
  for (const r of rows(s)) {
    const data = isoDate(r[0] ?? "");
    const valor = num(r[1]);
    if (data && valor) return { data, valor, var: num(r[2]) };
  }
  return null;
}

function praças(s?: Section): Praca[] {
  return rows(s)
    .filter((r) => r.length >= 2 && !/Munic|Atualizado|Tipo$/i.test(r[0]) && num(r[1]) && !/\*\*\*/.test(r[1]))
    .map((r) => ({ local: r[0], preco: num(r[1])!, var: r[2] && r[2].trim() !== "-" ? num(r[2]) : null }));
}

function contratos(s: Section | undefined, comRS: boolean): Contrato[] {
  return rows(s)
    .filter((r) => /^[A-Za-zÀ-ú]+\/\d{2,4}$/.test(r[0]?.trim() ?? "") && num(r[1]))
    .map((r) => ({
      mes: r[0].trim(),
      preco: num(r[1])!,
      rs: comRS ? num(r[2]) : undefined,
      var: comRS ? num(r[3]) : num(r[2]),
    }));
}

/** Página principal: https://www.noticiasagricolas.com.br/cotacoes/cafe */
export function parseCotacoes(html: string) {
  const secs = sections(toItems(html));
  const sArab = find(secs, /Indicador Caf[ée] Ar[áa]bica/i);
  const sRob = find(secs, /Indicador Caf[ée] (Robusta|Conil)/i);
  const sNY = find(secs, /Nova Iorque/i);
  const sB3 = find(secs, /Ar[áa]bica 4\/5.*B3/i);
  const sLon = find(secs, /Londres/i);
  const s67 = find(secs, /Tipo 6\/7/i);
  const s6 = find(secs, /Tipo 6 Bebida Dura/i, /6\/7/);
  const sCD = find(secs, /Cereja Descascado/i);
  const sCon = find(secs, /Conilon.*Dispon/i);
  const sLiveNY = find(secs, /NEW YORK.*NYBOT/i);
  const sLiveB3 = find(secs, /^BRASIL.*B3/i);

  let dolarNA: number | null = null;
  for (const r of rows(sNY)) {
    const m = r.join(" ").match(/D[óo]lar:?\s*([\d.,]+)/i);
    if (m) dolarNA = num(m[1]);
  }

  const live = (s: Section | undefined, re: RegExp) => {
    const r = rows(s).find((x) => re.test(x[0] ?? ""));
    const upd = rows(s).map((x) => x.join(" ")).join(" ").match(/atualiza[çc][ãa]o:?\s*(\d{1,2}:\d{2})\s*\((\d{2}\/\d{2})\)/i);
    return r ? { contrato: r[0], preco: num(r[1]), var: num(r[2]), hora: upd ? `${upd[2]} ${upd[1]}` : null } : null;
  };

  const conilonES = rows(sCon)
    .filter((r) => num(r[1]) && !/\*\*\*/.test(r[1]))
    .map((r) => ({ tipo: r[0], preco: num(r[1])!, var: num(r[2]) }));

  // Manchetes de café (título + link)
  const noticias: { titulo: string; url: string; data: string | null }[] = [];
  const seen = new Set<string>();
  const are = /<a[^>]+href="([^"]*\/noticias\/cafe\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = are.exec(html)) && noticias.length < 8) {
    const titulo = clean(m[2]);
    const url = m[1].startsWith("http") ? m[1] : `https://www.noticiasagricolas.com.br${m[1]}`;
    if (titulo.length < 25 || seen.has(url)) continue;
    seen.add(url);
    const antes = clean(html.slice(Math.max(0, m.index - 160), m.index));
    const d = [...antes.matchAll(/\b(\d{2}\/\d{2})(?!\/\d)/g)].pop();
    noticias.push({ titulo, url, data: d ? d[1] : null });
  }

  return {
    cepeaArabica: indicador(sArab),
    cepeaRobusta: indicador(sRob),
    ny: { contratos: contratos(sNY, true), dolar: dolarNA, data: atualizado(sNY) },
    b3: { contratos: contratos(sB3, false), data: atualizado(sB3) },
    londres: { contratos: contratos(sLon, false), data: atualizado(sLon) },
    fisico: {
      tipo6: praças(s6),
      tipo67: praças(s67),
      cd: praças(sCD),
      data: atualizado(s6) ?? atualizado(s67),
    },
    conilonES: { itens: conilonES, data: atualizado(sCon) },
    aoVivo: { nyCafe: live(sLiveNY, /^Caf[ée]/i), dolarFut: live(sLiveB3, /D[óo]lar/i) },
    noticias,
  };
}

/** Páginas de histórico: lista "Fechamento: dd/mm/aaaa" + tabela. Devolve {data: valor}. */
export function parseHistorico(html: string, tipo: "indicador" | "contrato"): Record<string, { valor: number; rs?: number | null }> {
  const items = toItems(html);
  const out: Record<string, { valor: number; rs?: number | null }> = {};
  let dataAtual: string | null = null;
  let pegouContrato = false;
  for (const it of items) {
    const text = it.t === "row" ? it.cells.join(" ") : it.text;
    const f = text.match(/Fechamento:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (f) { dataAtual = isoDate(f[1]); pegouContrato = false; continue; }
    if (it.t !== "row") continue;
    if (tipo === "indicador") {
      const d = isoDate(it.cells[0] ?? "");
      const v = num(it.cells[1]);
      if (d && v) out[d] = { valor: v };
    } else if (dataAtual && !pegouContrato && /^[A-Za-zÀ-ú]+\/\d{2,4}$/.test(it.cells[0]?.trim() ?? "") && num(it.cells[1])) {
      out[dataAtual] = { valor: num(it.cells[1])!, rs: num(it.cells[2]) };
      pegouContrato = true; // primeiro contrato = vencimento mais próximo
    }
  }
  return out;
}
