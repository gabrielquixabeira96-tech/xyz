# -*- coding: utf-8 -*-
"""Converte o material bruto de content-src/ no dataset da plataforma.

Regra de ouro: este script TRANSPORTA conteúdo, nunca o reescreve. Nenhum
enunciado, comentário, cartão ou aula é resumido, corrigido ou inventado.
Todo item que não puder ser parseado vai para o relatório de quarentena —
perda silenciosa é falha do build.

    python3 tools/build_content.py
"""
import csv, html, json, os, re, sys, unicodedata
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import taxonomia as TX

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(RAIZ, "content-src")
OUT = os.path.join(RAIZ, "assets", "data")

quarentena = []


def qtn(origem, trecho, motivo):
    quarentena.append({"origem": origem, "trecho": trecho[:280], "motivo": motivo})


# ── utilitários de texto ────────────────────────────────────────────────
def sem_acento(s):
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def chave(s):
    return re.sub(r"\s+", " ", sem_acento(s or "").lower()).strip()


# Emoji exportado como bytes UTF-8 lidos em latin-1 (ex.: "ð\x9f\x93\x8c" no lugar de 🔬)
MOJIBAKE = re.compile(r"[\u00c2-\u00f4][\u0080-\u00bf]{1,3}|[\u0080-\u009f]|[\uf000-\uf8ff]|[\ufffd]")
DESESCAPE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!|>~])")


def limpar(txt):
    """Desescapa o markdown exportado do Google Docs e remove lixo de encoding.

    O export do Docs escapa em duas camadas (``\\\\\\>`` para um simples ``>``),
    por isso o desescape roda até estabilizar.
    """
    if not txt:
        return ""
    txt = txt.replace("\u00a0", " ")
    txt = html.unescape(txt)
    txt = MOJIBAKE.sub("", txt)
    for _ in range(3):
        novo = DESESCAPE.sub(r"\1", txt)
        if novo == txt:
            break
        txt = novo
    txt = re.sub(r"[ \t]+", " ", txt)
    return txt.strip()


QUEBRA = "\u0001BR\u0001"


def inline_html(txt):
    """Markdown inline (negrito/itálico/código) → HTML, com escape prévio."""
    t = limpar(txt).replace("\n", QUEBRA)
    t = html.escape(t)
    t = re.sub(r"\*\*\*(.+?)\*\*\*", r"<strong><em>\1</em></strong>", t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*([^*\n]+?)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"`([^`]+?)`", r"<code>\1</code>", t)
    return t.replace(QUEBRA, "<br>")


RODAPE = re.compile(r"^Simulado ENARE R\+ Cirurgia — .*Página \d+\s*$", re.M)


# ── classificação em matéria/tema ───────────────────────────────────────
REGRAS = []  # (peso, palavra, area, tema)
for area, tema, kws in TX.TEMAS:
    for kw in kws:
        REGRAS.append((len(kw), chave(kw), area, tema))
REGRAS.sort(key=lambda r: -r[0])


def classificar(texto, area_fixa=None):
    """Devolve (area, tema). Se area_fixa vier, só considera temas dela."""
    k = chave(texto)
    for _, kw, area, tema in REGRAS:
        if area_fixa and area != area_fixa:
            continue
        if kw in k:
            return area, tema
    return None, None


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", chave(s)).strip("-")
    return s[:60] or "item"


# ── 1. Simulado: enunciados e alternativas ──────────────────────────────
def parse_simulado(path):
    bruto = RODAPE.sub("", open(path, encoding="utf-8").read())
    # corta o preâmbulo: começa na primeira linha "**1.**"
    m = re.search(r"^\*\*1\.\*\*\s*$", bruto, re.M)
    if not m:
        qtn(path, bruto[:200], "não localizei o início do caderno de questões")
        return {}
    corpo = bruto[m.start():]
    partes = re.split(r"^\*\*(\d{1,2})\.\*\*\s*$", corpo, flags=re.M)
    questoes = {}
    for i in range(1, len(partes) - 1, 2):
        n = int(partes[i])
        bloco = partes[i + 1]
        pos = re.search(r"\*\*x?\s*A\)\*\*", bloco)
        if not pos:
            qtn(path, bloco, f"questão {n} sem alternativa A identificável")
            continue
        enunciado = limpar(re.sub(r"\s*\n\s*", " ", bloco[:pos.start()]))
        alts_txt = bloco[pos.start():]
        pedacos = re.split(r"\*\*x?\s*([A-E])\)\*\*", alts_txt)
        alts = []
        for j in range(1, len(pedacos) - 1, 2):
            letra = pedacos[j]
            texto = limpar(re.sub(r"\s*\n\s*", " ", pedacos[j + 1]))
            if texto:
                alts.append({"k": letra, "texto": texto})
        if len(alts) < 4 or not enunciado:
            qtn(path, bloco, f"questão {n}: {len(alts)} alternativas extraídas (esperado 5)")
            continue
        revisar = len(alts) != 5
        if revisar:
            qtn(path, bloco, f"questão {n}: {len(alts)} de 5 alternativas no arquivo de origem "
                             "— entra na plataforma marcada para revisão, sem completar o que falta")
        questoes[n] = {"n": n, "enunciado": enunciado, "alternativas": alts,
                       "revisar": revisar}
    return questoes


# ── 2. Gabarito comentado ───────────────────────────────────────────────
CAMPOS = [
    ("fonte", "Questão-fonte."),
    ("bibliografia", "Bibliografia identificada."),
    ("alterado", "O que foi alterado (e por que muda a conduta)."),
    ("comentario", "Comentário."),
    ("distratores", "Por que as demais erram."),
    ("lacuna", "Lacuna testada."),
]


def parse_gabarito(path):
    bruto = RODAPE.sub("", open(path, encoding="utf-8").read())
    partes = re.split(r"^Questão (\d{1,2}) — (.+)$", bruto, flags=re.M)
    gab = {}
    for i in range(1, len(partes) - 1, 3):
        n = int(partes[i])
        area_txt = limpar(partes[i + 1])
        bloco = partes[i + 2]
        d = {"n": n, "areaTexto": area_txt}
        mc = re.search(r"Resposta correta:\s*([A-E])", bloco)
        if not mc:
            qtn(path, bloco, f"questão {n} sem 'Resposta correta'")
            continue
        d["correta"] = mc.group(1)
        ma = re.search(r"Alternativa [A-E]:\s*(.+)", bloco)
        d["textoCorreto"] = limpar(ma.group(1)) if ma else ""
        for campo, rotulo in CAMPOS:
            mm = re.search(re.escape(rotulo) + r"\s*(.*?)(?=\n\n(?:" +
                           "|".join(re.escape(r) for _, r in CAMPOS) + r")|\Z)",
                           bloco, re.S)
            d[campo] = limpar(re.sub(r"\s*\n\s*", " ", mm.group(1))) if mm else ""
        gab[n] = d
    return gab


# ── 3. Ebook ────────────────────────────────────────────────────────────
ROTULOS = {
    "o que cai": ("conceito", "O que cai"),
    "a pegadinha": ("alerta", "A pegadinha"),
    "macete": ("macete", "Macete"),
    "fixacao": ("fixacao", "Fixação"),
}


def celulas_tabela(linhas):
    """Recebe as linhas de uma tabela markdown e devolve a matriz de células."""
    linhas = [l for l in linhas if not re.match(r"^\|[\s:|-]+\|$", l)]
    matriz = []
    for l in linhas:
        cels = [c.strip() for c in l.strip().strip("|").split("|")]
        matriz.append(cels)
    return matriz


def parse_ebook(path):
    bruto = open(path, encoding="utf-8").read()
    partes = re.split(r"^## \*\*(\d+)\.(\d+)\*\*\s+\*\*(.+?)\*\*(.*)$", bruto, flags=re.M)
    aulas = []
    for i in range(1, len(partes) - 3, 5):
        mod, sub, titulo, cauda, corpo = partes[i], partes[i + 1], partes[i + 2], partes[i + 3], partes[i + 4]
        titulo = limpar(titulo)
        origem = limpar(cauda).strip("* ")
        blocos = []
        linhas = corpo.split("\n")
        j = 0
        while j < len(linhas):
            linha = linhas[j]
            if linha.startswith("|"):
                bloco = []
                while j < len(linhas) and linhas[j].startswith("|"):
                    bloco.append(linhas[j]); j += 1
                matriz = celulas_tabela(bloco)
                if not matriz:
                    continue
                if len(matriz[0]) == 1:
                    texto = " ".join(r[0] for r in matriz if r and r[0]).strip()
                    if not texto:
                        continue
                    mrot = re.match(r"\\?\*\\?\*\s*(.{0,80}?)\s*\\?\*\\?\*(.*)", texto, re.S)
                    tipo, rot, resto = "nota", "", texto
                    if mrot:
                        cab = chave(limpar(mrot.group(1)))
                        resto = mrot.group(2)
                        for k, (t, r) in ROTULOS.items():
                            if k in cab:
                                tipo, rot = t, r
                                break
                        else:
                            rot = limpar(mrot.group(1))
                            resto = mrot.group(2)
                    blocos.append({"tipo": "caixa", "estilo": tipo, "rotulo": rot,
                                   "html": inline_html(resto)})
                else:
                    cab = [inline_html(c) for c in matriz[0]]
                    corpo_t = [[inline_html(c) for c in r] for r in matriz[1:]]
                    blocos.append({"tipo": "tabela", "cabecalho": cab, "linhas": corpo_t})
                continue
            if linha.startswith("### "):
                blocos.append({"tipo": "subtitulo",
                               "html": inline_html(linha[4:].strip())})
            elif limpar(linha):
                blocos.append({"tipo": "paragrafo", "html": inline_html(linha)})
            j += 1
        if not blocos:
            qtn(path, titulo, "aula do ebook sem blocos de conteúdo")
            continue
        area_pad = TX.MODULO_EBOOK.get(mod, "transversais")
        area, tema = classificar(titulo, area_pad)
        if not tema:
            area, tema = classificar(titulo)
        if not tema:
            area, tema = area_pad, None
        aulas.append({"id": f"aula-{mod}-{sub}", "modulo": f"{mod}.{sub}",
                      "titulo": titulo, "origem": origem, "areaSlug": area,
                      "tema": tema, "blocos": blocos})
    return aulas


# ── 4. Flashcards ───────────────────────────────────────────────────────
def parse_flashcards(path):
    cards = []
    with open(path, encoding="utf-8") as f:
        for idx, linha in enumerate(csv.reader(f, delimiter="\t")):
            if len(linha) < 3 or not linha[0].strip():
                if any(c.strip() for c in linha):
                    qtn(path, "\t".join(linha), f"linha {idx+1} fora do formato frente/verso/deck")
                continue
            frente, verso, deck = limpar(linha[0]), limpar(linha[1]), linha[2].strip()
            deck_curto = deck.replace("ENARE::", "")
            alvo = frente + " " + verso
            area, tema = classificar(frente)
            if not tema:
                area, tema = classificar(alvo)
            if not tema:
                area, tema = TX.FALLBACK_POR_DECK.get(deck_curto, ("transversais", "Outros conceitos"))
            cards.append({"id": f"c{idx+1:03d}", "frente": frente, "verso": verso,
                          "deck": deck_curto, "areaSlug": area, "tema": tema})
    return cards


# ── montagem ────────────────────────────────────────────────────────────
IMAGENS = sorted(f for f in os.listdir(os.path.join(RAIZ, "assets", "img")) if f.endswith(".png"))


_usadas = []


def imagem_para(chave_txt, exclusiva=False):
    """Escolhe uma placa para o ladrilho. `exclusiva` reserva imagens distintas
    para as matérias, que aparecem todas juntas na mesma tela."""
    if exclusiva and len(_usadas) < len(IMAGENS):
        img = IMAGENS[len(_usadas)]
        _usadas.append(img)
        return "assets/img/" + img
    h = 0
    for ch in chave_txt:
        h = (h * 31 + ord(ch)) % 100000
    return "assets/img/" + IMAGENS[h % len(IMAGENS)]


def main():
    imagens_area = {a[0]: imagem_para(a[0], True) for a in TX.AREAS}
    simulado = parse_simulado(os.path.join(SRC, "simulado80.md"))
    gabarito = parse_gabarito(os.path.join(SRC, "gabarito80.md"))
    aulas = parse_ebook(os.path.join(SRC, "ebook.md"))
    cards = parse_flashcards(os.path.join(SRC, "flashcards.tsv"))

    # questões = simulado ∪ gabarito
    questoes = []
    for n in sorted(set(simulado) | set(gabarito)):
        s, g = simulado.get(n), gabarito.get(n)
        if not s or not g:
            qtn("simulado80/gabarito80", f"questão {n}",
                "enunciado sem gabarito" if s else "gabarito sem enunciado")
            continue
        area = TX.AREA_DO_SIMULADO.get(chave(g["areaTexto"]))
        if not area:
            area, _ = classificar(g["areaTexto"])
        area = area or "transversais"
        _, tema = classificar(g["comentario"] + " " + s["enunciado"], area)
        if not tema:
            _, tema = classificar(g["areaTexto"], area)
        q = dict(s)
        q.update({k: g[k] for k in ("correta", "textoCorreto", "areaTexto",
                                    "fonte", "bibliografia", "alterado",
                                    "comentario", "distratores", "lacuna")})
        q["areaSlug"] = area
        q["tema"] = tema
        questoes.append(q)

    # índice de temas
    temas = {}
    ordem_tema = {}
    for pos, (a, t, _) in enumerate(TX.TEMAS):
        ordem_tema[(a, t)] = pos

    def tema_id(area, nome):
        return f"{area}--{slug(nome)}"

    def garantir(area, nome):
        if not nome:
            nome = "Outros conceitos"
        tid = tema_id(area, nome)
        if tid not in temas:
            temas[tid] = {"id": tid, "areaSlug": area, "nome": nome,
                          "img": imagem_para(tid), "aulas": [], "questoes": [],
                          "cards": [], "ordem": ordem_tema.get((area, nome), 999)}
        return temas[tid]

    for a in aulas:
        t = garantir(a["areaSlug"], a["tema"])
        a["temaId"] = t["id"]
        t["aulas"].append(a["id"])
    for q in questoes:
        t = garantir(q["areaSlug"], q["tema"])
        q["temaId"] = t["id"]
        t["questoes"].append(q["n"])
    for c in cards:
        t = garantir(c["areaSlug"], c["tema"])
        c["temaId"] = t["id"]
        t["cards"].append(c["id"])

    areas = []
    for sl, nome, sigla, peso, sub in TX.AREAS:
        seus = sorted([t for t in temas.values() if t["areaSlug"] == sl],
                      key=lambda t: (t["ordem"], t["nome"]))
        if not seus:
            continue
        areas.append({
            "slug": sl, "nome": nome, "sigla": sigla, "peso": peso,
            "subtitulo": sub, "img": imagens_area[sl],
            "temas": [t["id"] for t in seus],
            "nAulas": sum(len(t["aulas"]) for t in seus),
            "nQuestoes": sum(len(t["questoes"]) for t in seus),
            "nCards": sum(len(t["cards"]) for t in seus),
        })

    dados = {
        "gerado": True,
        "areas": areas,
        "temas": sorted(temas.values(), key=lambda t: (t["areaSlug"], t["ordem"], t["nome"])),
        "aulas": aulas,
        "questoes": questoes,
        "cards": cards,
        "quarentena": quarentena,
        "fontes": [
            {"titulo": "Ebook Rumo aos 100% — R+ Cirurgia Geral", "tipo": "Aulas", "itens": len(aulas)},
            {"titulo": "Simulado inédito ENARE R+ Cirurgia (80 questões)", "tipo": "Questões", "itens": len(questoes)},
            {"titulo": "Gabarito comentado e rastreio bibliográfico", "tipo": "Comentários", "itens": sum(1 for q in questoes if q["comentario"])},
            {"titulo": "Deck ENARE de repetição espaçada", "tipo": "Cartões", "itens": len(cards)},
            {"titulo": "Análise de padrões ENARE 2021-2026 e previsão 2027", "tipo": "Blueprint", "itens": len(areas)},
        ],
    }

    os.makedirs(OUT, exist_ok=True)
    caminho = os.path.join(OUT, "conteudo.js")
    with open(caminho, "w", encoding="utf-8") as f:
        f.write("/* Gerado por tools/build_content.py — não edite à mão. */\n")
        f.write("window.RM_DADOS = ")
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"áreas .......... {len(areas)}")
    print(f"temas .......... {len(temas)}")
    print(f"aulas .......... {len(aulas)}")
    print(f"questões ....... {len(questoes)} (com comentário: {sum(1 for q in questoes if q['comentario'])})")
    print(f"cartões ........ {len(cards)}")
    print(f"quarentena ..... {len(quarentena)}")
    for q in quarentena:
        print(f"   ! {q['origem']}: {q['motivo']}")
    print(f"→ {os.path.relpath(caminho, RAIZ)} ({os.path.getsize(caminho)//1024} KB)")


if __name__ == "__main__":
    main()
