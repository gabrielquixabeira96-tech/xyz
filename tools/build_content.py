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



# ── 5. Apresentações (slides) ───────────────────────────────────────────
def parse_apresentacoes(pasta):
    """Cada arquivo é uma apresentação; cada `## ` é um slide.

    Um `> area:` no cabeçalho define a área padrão; um `> area:` logo abaixo
    de um slide o reatribui. Com `> dividir: true`, cada slide vira uma aula
    própria — usado no guia de referência, que atravessa várias matérias.
    """
    aulas = []
    if not os.path.isdir(pasta):
        return aulas
    for nome in sorted(os.listdir(pasta)):
        if not nome.endswith(".md"):
            continue
        caminho = os.path.join(pasta, nome)
        bruto = open(caminho, encoding="utf-8").read()
        mt = re.match(r"# (.+)", bruto)
        if not mt:
            qtn(caminho, bruto[:120], "apresentação sem título de primeiro nível")
            continue
        titulo_geral = limpar(mt.group(1))
        cab = {}
        for k, v in re.findall(r"^> (\w+):\s*(.+)$", bruto[:bruto.find("\n## ")], re.M):
            cab[k] = v.strip()
        area_padrao = cab.get("area", "transversais")
        dividir = cab.get("dividir", "").lower() == "true"

        partes = re.split(r"^## (.+)$", bruto, flags=re.M)[1:]
        slides = []
        for i in range(0, len(partes) - 1, 2):
            titulo = limpar(partes[i])
            corpo = partes[i + 1]
            marea = re.match(r"\s*> area:\s*(\S+)", corpo)
            area = area_padrao
            if marea:
                area = marea.group(1)
                corpo = corpo[marea.end():]
            linhas = [inline_html(l) for l in corpo.split("\n") if limpar(l)]
            if not linhas:
                qtn(caminho, titulo, "slide sem conteúdo")
                continue
            slides.append({"titulo": titulo, "area": area, "linhas": linhas})
        if not slides:
            qtn(caminho, titulo_geral, "apresentação sem slides legíveis")
            continue

        base = nome[:-3]
        if dividir:
            for i, sl in enumerate(slides, 1):
                aulas.append(_aula_slides(
                    f"slides-{base}-{i:02d}", sl["titulo"], sl["area"],
                    [sl], cab, titulo_geral))
        else:
            aulas.append(_aula_slides(
                "slides-" + base, titulo_geral, area_padrao, slides, cab, None))
    return aulas


def _aula_slides(ident, titulo, area_padrao, slides, cab, parte_de):
    blocos = []
    for sl in slides:
        if len(slides) > 1:
            blocos.append({"tipo": "subtitulo", "html": inline_html(sl["titulo"])})
        for l in sl["linhas"]:
            blocos.append({"tipo": "paragrafo", "html": l})
    area, tema = classificar(titulo, area_padrao)
    if not tema:
        area, tema = area_padrao, None
    return {"id": ident, "formato": "slides", "modulo": "", "titulo": titulo,
            "origem": cab.get("origem", ""), "autor": cab.get("autor", ""),
            "parteDe": parte_de, "areaSlug": area_padrao, "tema": tema,
            "blocos": blocos, "nSlides": len(slides)}


# ── 6. Aulas interativas (HTML autocontido do autor) ────────────────────
INTERATIVAS = [
    {"id": "int-cancer-mama", "arquivo": "cancer-mama.html",
     "titulo": "Câncer de Mama — aula completa ENARE R+ Cirurgia",
     "area": "mama", "tema": "Câncer de mama — aula completa",
     "origem": "Aula-atlas interativa, com pranchas anatômicas em SVG",
     "secoes": ["Anatomia da mama e origem histológica", "Estratificação de risco",
                "Fluxograma de rastreio por categoria de risco", "Apresentações clínicas",
                "Subtipos moleculares", "Algoritmo de tratamento cirúrgico",
                "Anatomia cirúrgica da axila", "Armadilhas clássicas da FGV/ENARE"]},
    {"id": "int-tumores-testiculo", "arquivo": "tumores-testiculo.html",
     "titulo": "Tumores de Testículo — guia high-yield",
     "area": "urologia", "tema": "Tumores de testículo",
     "origem": "Guia interativo de uro-oncologia",
     "secoes": ["Introdução e epidemiologia", "Classificação histopatológica",
                "Marcadores tumorais", "Estadiamento — TNM 8ª edição",
                "Algoritmo de conduta", "Pegadinhas de prova"]},
]


def montar_interativas(raiz):
    aulas = []
    for it in INTERATIVAS:
        caminho = os.path.join(raiz, "assets", "interativas", it["arquivo"])
        if not os.path.exists(caminho):
            qtn(caminho, it["titulo"], "aula interativa não encontrada em assets/interativas")
            continue
        aulas.append({
            "id": it["id"], "formato": "interativa", "modulo": "",
            "titulo": it["titulo"], "origem": it["origem"], "autor": "",
            "areaSlug": it["area"], "tema": it["tema"], "parteDe": None,
            "src": "assets/interativas/" + it["arquivo"],
            "secoes": it["secoes"], "blocos": [],
            "peso": os.path.getsize(caminho),
        })
    return aulas


# ── 7. Questões dos HTMLs interativos do autor ──────────────────────────
def _q(ident, n, enunciado, alts, correta, **extra):
    d = {"id": ident, "n": n, "enunciado": enunciado, "alternativas": alts,
         "correta": correta, "revisar": False}
    d.update({k: v for k, v in extra.items() if v})
    return d


def parse_simulados_html(pasta):
    """Cada arquivo traz o array de questões extraído do HTML original."""
    questoes = []
    if not os.path.isdir(pasta):
        return questoes

    def carregar(nome):
        caminho = os.path.join(pasta, nome)
        if not os.path.exists(caminho):
            qtn(caminho, nome, "arquivo de questões não encontrado")
            return None
        return json.load(open(caminho, encoding="utf-8"))

    # Barrett — 44 questões (alts como dicionário, distratores por letra)
    dados = carregar("barrett-enare.json")
    for q in dados or []:
        alts = [{"k": k, "texto": limpar(v)} for k, v in sorted(q["alts"].items())]
        dist = q.get("distratores") or {}
        texto_dist = " ".join(f"({k}) {limpar(v)}" for k, v in sorted(dist.items())) if isinstance(dist, dict) else limpar(dist)
        questoes.append(_q(
            f"barrett-{q['id']}", q["id"], limpar(q["enunciado"]), alts, q["gab"],
            areaSlug="esofago", subtema=limpar(q.get("bloco", "")),
            comentario=limpar(q.get("correta", "")), distratores=texto_dist,
            gatilho=limpar(q.get("gatilho", "")), perola=limpar(q.get("perola", "")),
            colecao="Simulado Esôfago de Barrett — ENARE R+"))

    # Tumores neuroendócrinos do pâncreas — 42 questões (alts como lista com ok/nota)
    dados = carregar("tne-pancreas.json")
    for q in dados or []:
        alts, correta, notas = [], None, []
        for a in q.get("alts", []):
            alts.append({"k": a["letra"], "texto": limpar(a.get("txt", ""))})
            if a.get("ok"):
                correta = a["letra"]
            elif a.get("nota"):
                notas.append(f"({a['letra']}) {limpar(a['nota'])}")
        if not correta or len(alts) < 4:
            qtn("tne-pancreas.json", str(q.get("id")), "questão sem alternativa correta marcada")
            continue
        certa = next((a for a in q["alts"] if a.get("ok")), {})
        questoes.append(_q(
            f"tne-{q['id']}", q["id"], limpar(q.get("stem", "")), alts, correta,
            areaSlug="pancreas", subtema=limpar(q.get("bloco", "")),
            comentario=limpar(certa.get("nota", "")), distratores=" ".join(notas),
            gatilho=limpar(q.get("gatilho", "")), fisio=limpar(q.get("fisio", "")),
            perola=limpar(q.get("perola", "")),
            tags=", ".join(q.get("tags", [])),
            colecao="Simulado Tumores neuroendócrinos do pâncreas — ENARE R+"))

    # Tumores de testículo — 8 questões (índice da correta)
    dados = carregar("tumores-testiculo.json")
    for i, q in enumerate(dados or [], 1):
        letras = "ABCDE"
        alts = [{"k": letras[j], "texto": limpar(t)} for j, t in enumerate(q.get("opts", []))]
        idx = q.get("correct")
        if not alts or idx is None or idx >= len(alts):
            qtn("tumores-testiculo.json", str(q.get("q"))[:80], "questão sem gabarito utilizável")
            continue
        questoes.append(_q(
            f"testiculo-{i}", i, limpar(q.get("q", "")), alts, letras[idx],
            areaSlug="urologia", comentario=limpar(q.get("feedback", "")),
            colecao="Tumores de testículo — guia high-yield"))

    # Lista ENARE 2025 — 20 questões reais, com o rótulo de origem preservado
    dados = carregar("lista-r-cirurgia-20q.json")
    for q in dados or []:
        letras = "ABCDE"
        alts = [{"k": letras[j], "texto": limpar(t)} for j, t in enumerate(q["alts"])]
        questoes.append(_q(
            f"e25-{q['n']}", q["n"], limpar(q["stem"]), alts, q["gab"],
            metaOriginal=q.get("meta", ""),
            colecao="Lista ENARE 2025 · R+ Cirurgia (20 questões)"))
    return questoes


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
    aulas += parse_apresentacoes(os.path.join(SRC, "apresentacoes"))
    aulas += montar_interativas(RAIZ)
    cards = parse_flashcards(os.path.join(SRC, "flashcards.tsv"))

    # questões do simulado inédito = enunciado ∪ gabarito comentado
    questoes = []
    for n in sorted(set(simulado) | set(gabarito)):
        s_, g = simulado.get(n), gabarito.get(n)
        if not s_ or not g:
            qtn("simulado80/gabarito80", f"questão {n}",
                "enunciado sem gabarito" if s_ else "gabarito sem enunciado")
            continue
        area = TX.AREA_DO_SIMULADO.get(chave(g["areaTexto"]))
        if not area:
            area, _ = classificar(g["areaTexto"])
        q = dict(s_)
        q.update({k: g[k] for k in ("correta", "textoCorreto", "areaTexto",
                                    "fonte", "bibliografia", "alterado",
                                    "comentario", "distratores", "lacuna")})
        q["id"] = f"sim80-{n}"
        q["areaSlug"] = area or "transversais"
        q["colecao"] = "Simulado inédito ENARE R+ Cirurgia (80 questões)"
        questoes.append(q)

    questoes += parse_simulados_html(os.path.join(SRC, "simulados-html"))

    # classificação em tema de tudo que ainda não tem
    for q in questoes:
        # O conteúdo manda; o rótulo de origem é só desempate. Alguns rótulos
        # da lista ENARE 2025 não correspondem ao assunto do enunciado, e
        # corrigi-los no arquivo seria reescrever a fonte.
        conteudo = " ".join(str(q.get(k, "")) for k in
                            ("comentario", "gatilho", "perola", "fisio",
                             "subtema", "enunciado", "textoCorreto"))
        # Só a alternativa correta entra: os distratores são construídos sobre
        # temas vizinhos de propósito e puxariam a classificação para o lado errado.
        certa = next((a["texto"] for a in q.get("alternativas", [])
                      if a["k"] == q.get("correta")), "")
        conteudo += " " + certa
        rotulo = " ".join(str(q.get(k, "")) for k in ("areaTexto", "metaOriginal"))
        area = q.get("areaSlug")
        if not area:
            area, _ = classificar(conteudo)
            if not area:
                area, _ = classificar(rotulo)
            q["areaSlug"] = area = area or "transversais"
        _, tema = classificar(conteudo, area)
        if not tema:
            _, tema = classificar(rotulo, area)
        q["tema"] = tema

    # índice de temas
    temas = {}
    ordem_tema = {(a, t): pos for pos, (a, t, _) in enumerate(TX.TEMAS)}

    def garantir(area, nome):
        if not nome:
            nome = "Outros conceitos"
        tid = f"{area}--{slug(nome)}"
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
        t["questoes"].append(q["id"])
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

    por_formato = {}
    for a in aulas:
        por_formato[a.get("formato", "ebook")] = por_formato.get(a.get("formato", "ebook"), 0) + 1
    colecoes = {}
    for q in questoes:
        colecoes[q.get("colecao", "—")] = colecoes.get(q.get("colecao", "—"), 0) + 1

    dados = {
        "gerado": True,
        "areas": areas,
        "temas": sorted(temas.values(), key=lambda t: (t["areaSlug"], t["ordem"], t["nome"])),
        "aulas": aulas,
        "questoes": questoes,
        "cards": cards,
        "quarentena": quarentena,
        "fontes": (
            [{"titulo": "Ebook Rumo aos 100% — R+ Cirurgia Geral", "tipo": "Aulas do ebook",
              "itens": por_formato.get("ebook", 0)},
             {"titulo": "Apresentações e reuniões científicas", "tipo": "Aulas de slides",
              "itens": por_formato.get("slides", 0)},
             {"titulo": "Aulas-atlas interativas em HTML", "tipo": "Aulas interativas",
              "itens": por_formato.get("interativa", 0)}]
            + [{"titulo": k, "tipo": "Questões", "itens": v}
               for k, v in sorted(colecoes.items(), key=lambda kv: -kv[1])]
            + [{"titulo": "Deck ENARE de repetição espaçada", "tipo": "Cartões", "itens": len(cards)},
               {"titulo": "Análise de padrões ENARE 2021-2026 e previsão 2027",
                "tipo": "Blueprint", "itens": len(areas)}]
        ),
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
    print(f"aulas .......... {len(aulas)}  " +
          " · ".join(f"{k}: {v}" for k, v in sorted(por_formato.items())))
    com = sum(1 for q in questoes if q.get("comentario"))
    print(f"questões ....... {len(questoes)} (com comentário: {com})")
    for k, v in sorted(colecoes.items(), key=lambda kv: -kv[1]):
        print(f"   · {v:>3}  {k}")
    print(f"cartões ........ {len(cards)}")
    print(f"quarentena ..... {len(quarentena)}")
    for q in quarentena:
        print(f"   ! {q['origem']}: {q['motivo']}")
    print(f"→ {os.path.relpath(caminho, RAIZ)} ({os.path.getsize(caminho)//1024} KB)")


if __name__ == "__main__":
    main()
