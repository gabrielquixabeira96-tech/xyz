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
    # ── Aulas-atlas importadas dos artefatos do autor no claude.ai ──────
    {"id": "int-hemorragia-digestiva", "arquivo": "hemorragia-digestiva.html",
     "titulo": "Atlas da Hemorragia Digestiva",
     "area": "estomago-duodeno", "tema": "Hemorragia digestiva alta e Forrest",
     "origem": "Aula-atlas interativa (artefato claude.ai W1szjtcLjB6XqA25X4x7bF)",
     "secoes": ["Antes de começar: o vocabulário", "Os primeiros minutos",
                "A úlcera que sangra", "Varizes: o sangramento da pressão",
                "Outras causas de HDA", "Hemorragia digestiva baixa",
                "Achar o ponto que sangra", "Quando e como operar", "Forja",
                "Tabela-mãe: gatilho → conduta"]},
    {"id": "int-retossigmoidectomia", "arquivo": "retossigmoidectomia.html",
     "titulo": "Atlas da Retossigmoidectomia",
     "area": "coloproctologia", "tema": "Câncer de reto",
     "origem": "Aula-atlas interativa (artefato claude.ai 1hoRopJL29zKBTBaRPMuT6)",
     "secoes": ["Vocabulário", "Anatomia cirúrgica", "Estadiamento e planejamento",
                "Posicionamento e acesso", "Tempo vascular", "Excisão total do mesorreto",
                "Reconstrução", "Peça e patologia", "Complicações",
                "Resultados e seguimento", "Forja", "Tabela-mãe: gatilho → conduta"]},
    {"id": "int-ulcera-duodenal", "arquivo": "ulcera-duodenal.html",
     "titulo": "Atlas da Úlcera Duodenal",
     "area": "estomago-duodeno", "tema": "Úlcera péptica e perfuração",
     "origem": "Aula-atlas interativa com modelo 3D (artefato claude.ai N262tVaL8qJ1gtviydWAtY)",
     "secoes": ["A vizinhança do bulbo duodenal", "A úlcera anterior perfura",
                "A úlcera posterior sangra", "Por que ligar uma vez só não resolve",
                "Embolização em sanduíche", "Kissing ulcers", "Úlcera perfurada",
                "Úlcera sangrante", "Como a banca cobra e onde estão as armadilhas",
                "Seis questões no nível de R+"]},
    {"id": "int-mama-luminal-inicial", "arquivo": "mama-luminal-inicial.html",
     "titulo": "Câncer de mama inicial luminal A-like: do laudo à alta do seguimento",
     "area": "mama", "tema": "Tratamento cirúrgico da mama",
     "origem": "Aula-atlas interativa (artefato claude.ai J5wkgVhznb6pzmgHEJ9uN4)",
     "secoes": ["Antes de começar: o vocabulário do caso",
                "Lendo o laudo: do microscópio ao subtipo",
                "Estadiamento: o tamanho que falta e os exames que não se pedem",
                "Cirurgia da mama: conservar, localizar, ter margem",
                "A axila: estadiar sem mutilar",
                "Radioterapia: mama toda, parte dela ou nenhuma",
                "Terapia sistêmica: o comprimido de cinco anos",
                "Seguimento e genética: vigiar sem exagerar",
                "Tabela-mãe e forja de questões"]},
    {"id": "int-trauma-pelvico", "arquivo": "trauma-pelvico.html",
     "titulo": "Atlas do Trauma Pélvico",
     "area": "trauma", "tema": "Trauma de bacia e choque neurogênico",
     "origem": "Aula-atlas interativa (artefato claude.ai 5Nqz7Ny9d38N3m2mtVw98S)",
     "secoes": ["Vocabulário antes da sala", "O anel ósseo e os ligamentos que o seguram",
                "De onde sangra", "Classificação: vetor de força, estabilidade e volume",
                "Na sala de trauma: RX, FAST e TC", "O binder", "Máquina de decisão",
                "Packing pré-peritoneal", "Angioembolização",
                "REBOA e estabilização mecânica", "Bexiga e uretra",
                "Fratura exposta e lesão retal", "Forja: uma questão-mãe e sete pivôs",
                "Tabela-mãe"]},
    {"id": "int-hiperparatireoidismo-primario", "arquivo": "hiperparatireoidismo-primario.html",
     "titulo": "Atlas do Hiperparatireoidismo Primário",
     "area": "endocrino-cp", "tema": "Paratireoide e hipercalcemia",
     "origem": "Aula-atlas interativa (artefato claude.ai ToYFC4xdtpLmCtrnp9dC7E)",
     "secoes": ["Vocabulário de trabalho", "O termostato desregulado", "Quem vai para a sala",
                "Quem nasce em cima termina embaixo", "A imagem localiza, não diagnostica",
                "Menor via segura", "A curva que fecha a incisão", "Quando são quatro",
                "Adenoma, ou algo pior", "O relógio dos seis meses",
                "Oito casos, um pivô por vez", "Tabela-mãe: gatilho → conduta"]},
    {"id": "int-incidentaloma-adrenal", "arquivo": "incidentaloma-adrenal.html",
     "titulo": "Atlas do Incidentaloma Adrenal",
     "area": "endocrino-cp", "tema": "Adrenal e feocromocitoma",
     "origem": "Aula-atlas interativa (artefato claude.ai AkUp3fUND3qhZQAWn2BTFB)",
     "secoes": ["A tomografia que o radiologista viu",
                "Por que o adenoma é escuro e por que ele lava",
                "As camadas, e o que cada uma faz quando se rebela",
                "A máquina de duas perguntas", "Alfa antes do beta: o vaso explica",
                "Na mesa: as duas veias que decidem a cirurgia",
                "Forja: a mesma questão, oito pivôs", "Tabela-mãe"]},
    {"id": "int-linfoma-malt", "arquivo": "linfoma-malt.html",
     "titulo": "Atlas do Linfoma MALT gástrico",
     "area": "estomago-duodeno", "tema": "Câncer gástrico",
     "origem": "Aula-atlas interativa (artefato claude.ai 5W9F2D6pG27uuZZtJkeYTf)",
     "secoes": ["Vocabulário em 12 cartões", "O que o endoscopista viu",
                "Histologia: a lesão linfoepitelial",
                "Imuno-histoquímica: provar que é B e excluir os parecidos",
                "Profundidade: ecoendoscopia e estadiamento", "Tratamento e resposta",
                "Máquina de decisão", "Sete questões, um caso", "Gatilho → conduta"]},
    {"id": "int-neuroendocrinos", "arquivo": "neuroendocrinos.html",
     "titulo": "Atlas dos Neuroendócrinos — do Ki-67 à mesa",
     "area": "apendice-delgado", "tema": "Tumores neuroendócrinos do delgado e apêndice",
     "origem": "Aula-atlas interativa (artefato claude.ai VqZispRw5LpXfhnGq8f2ra)",
     "secoes": ["Antes de começar: o vocabulário do caso", "A lâmina que decide tudo",
                "O receptor que faz o tumor brilhar", "A régua muda com o órgão",
                "As síndromes funcionantes: do sintoma ao hormônio",
                "Por que a síndrome carcinoide precisa do fígado",
                "A crise carcinoide, e a droga que piora tudo",
                "A máquina de decisão em três perguntas",
                "Na mesa: o mesentério é a doença", "A escada da doença metastática",
                "A forja: a mesma questão, um dado trocado", "Tabela-mãe: gatilho e ação"]},
    {"id": "int-anticoagulacao-perioperatoria", "arquivo": "anticoagulacao-perioperatoria.html",
     "titulo": "Atlas da Anticoagulação Perioperatória",
     "area": "perioperatorio", "tema": "Tromboprofilaxia",
     "origem": "Aula-atlas interativa (artefato claude.ai Vfq7XkWXidMrXQ1Hdx931K)",
     "secoes": ["Antes de começar: o vocabulário do caso", "O relógio da droga",
                "Onde cada droga corta a cascata",
                "O buraco da varfarina, e por que o DOAC não tem", "A máquina de decisão",
                "Reversão: o que a banca pune", "Neuroeixo, e o caminho de volta",
                "Forja — nove versões da mesma questão", "Tabela-mãe"]},
    {"id": "int-intussuscepcao-adulto", "arquivo": "intussuscepcao-adulto.html",
     "titulo": "Atlas da Intussuscepção do Adulto",
     "area": "apendice-delgado", "tema": "Obstrução intestinal e bridas",
     "origem": "Aula-atlas interativa (artefato claude.ai 9iPAVraXLbnDYEF7DErbNd)",
     "secoes": ["O vocabulário antes do bisturi", "A TC que chegou ao plantão",
                "Por que o alvo existe — e por que ele estrangula",
                "O telescópio por dentro — e quem é o culpado no adulto jovem",
                "A máquina de decisão — três perguntas e nenhum enema",
                "Na mesa — a ileocólica que você vai ressecar",
                "Forja — a mesma prova, oito vidas",
                "Tabela-mãe — cada gatilho, uma conduta"]},
    {"id": "int-esplenectomia", "arquivo": "esplenectomia.html",
     "titulo": "Atlas da Esplenectomia",
     "area": "baco-transplante", "tema": "Esplenectomia e suas consequências",
     "origem": "Aula-atlas interativa (artefato claude.ai 4XJ3cJWhEoNRt3kkTJU3dP)",
     "secoes": ["Antes de começar — o vocabulário do caso", "O leito da recuperação",
                "Por que a hemoglobina cai e o lactato sobe",
                "O eixo que a prednisona apagou",
                "O baço por dentro — e por que a PTI o escolhe", "A máquina de decisão",
                "A reposição que a banca pune", "Na mesa — de onde o baço sangra",
                "O calendário das complicações",
                "A forja — a mesma questão em dez roupagens", "Tabela-mãe"]},
    {"id": "int-desfiladeiro-toracico", "arquivo": "desfiladeiro-toracico.html",
     "titulo": "Atlas do Desfiladeiro Torácico",
     "area": "toracica", "tema": "Traqueia e parede torácica",
     "origem": "Aula-atlas interativa (artefato claude.ai KL4LK1B3sSzvFXibhtY72B)",
     "secoes": ["O exame que o médico viu: angiografia com o braço subindo",
                "Por que o sinal existe: as três portas e a manobra que fecha cada uma",
                "A estrutura em camadas: do tronco inferior à mão de Gilliatt-Sumner",
                "A máquina de decisão: três perguntas, em ordem",
                "O simulador da veia: a sequência certa e o caminho errado",
                "Na mesa: a fossa supraclavicular direita aberta",
                "Forja: a questão-mãe e sete pivôs", "Tabela-mãe: gatilho → conduta"]},
    {"id": "int-esofago-barrett", "arquivo": "esofago-barrett.html",
     "titulo": "Atlas do Esôfago de Barrett",
     "area": "esofago", "tema": "Esôfago de Barrett",
     "origem": "Aula-atlas interativa (artefato claude.ai JGYzPFYZmkEgkxKP59nvAx)",
     "secoes": ["A endoscopia que o médico viu", "Por que a mucosa fica salmão",
                "A escada da displasia", "A máquina de decisão",
                "A profundidade que escolhe o instrumento",
                "Na mesa — a junção que o enunciado mede", "A forja", "A tabela-mãe"]},
    {"id": "int-adenoma-papila-vater", "arquivo": "adenoma-papila-vater.html",
     "titulo": "Adenoma de papila de Vater",
     "area": "pancreas", "tema": "Adenocarcinoma de pâncreas",
     "origem": "Aula-atlas interativa empacotada (artefato claude.ai F9oKwcd2Fav4izkuRqQG57)",
     "secoes": ["O complexo ampular, camada por camada",
                "O que o duodenoscópio viu — e as seis papilas possíveis",
                "A ecoendoscopia decide: profundidade, não displasia",
                "Por que icterícia flutuante e por que anemia ferropriva",
                "A máquina de decisão", "Na mesa: três ressecções, três preços",
                "Depois da alça: complicações e vigilância",
                "A forja: sete pivôs da mesma questão", "A tabela-mãe"]},
    {"id": "int-carencias-pos-bariatrica", "arquivo": "carencias-pos-bariatrica.html",
     "titulo": "Carências pós-bariátrica — 30 casos de pares contrastados",
     "area": "bariatrica", "tema": "Complicações da bariátrica",
     "origem": "Bloco interativo de questões (artefato claude.ai VGAGUXG6Entocw1b2Jv4Ag)",
     "secoes": ["30 questões com correção imediata",
                "Tabela de bolso — todas as carências"]},
    {"id": "int-fisiopatologia-carencias", "arquivo": "fisiopatologia-carencias.html",
     "titulo": "Fisiopatologia das Carências — da molécula ao sintoma",
     "area": "bariatrica", "tema": "Complicações da bariátrica",
     "origem": "Texto interativo (artefato claude.ai NML9QvTRDAvb9asRFqWCBD)",
     "secoes": ["O que faz de algo uma vitamina", "O eixo que organiza tudo: solubilidade",
                "Por que existe um “complexo B”", "B1 e B12: o que as une e o que as separa",
                "Tiamina, B12 e folato", "Ferro, cobre e zinco",
                "Vitaminas A, E, K e D com cálcio", "Magnésio, selênio e proteína",
                "Oxalato: a carência que vira cálculo",
                "Os quatro eixos que organizam todos os sintomas",
                "O relógio de cada carência"]},
    {"id": "int-cabeca-pescoco-na-mesa", "arquivo": "cabeca-pescoco-na-mesa.html",
     "titulo": "Cabeça e Pescoço na Mesa — Prancha Cervical",
     "area": "endocrino-cp", "tema": "Câncer de tireoide",
     "origem": "Prancha interativa (artefato claude.ai RDiHJNxPSd49qo9rKKc5hm)",
     "secoes": ["As fáscias decidem para onde a infecção vai",
                "Os níveis, o sítio primário e o nome do esvaziamento",
                "A captação separa duas doenças com o mesmo sintoma",
                "O nódulo: cinco eixos, uma pontuação, uma decisão",
                "Quatro relógios — e a parede que decide a operação",
                "As duas complicações que definem um serviço de tireoide",
                "Cálcio alto: operar, observar ou nem era doença cirúrgica",
                "A parótida é atravessada pelo nervo que move o rosto",
                "Dois centímetros que trocam a doença inteira",
                "A laringe tem três andares e só um deles quase não drena",
                "A hierarquia da via aérea não muda — o ponto de entrada, sim",
                "Massa cervical: idade, tempo e consistência decidem",
                "Forja: dez pivôs, dez condutas", "Tabela-mãe: o gatilho e a ação"]},
    {"id": "int-prancha-anestesica", "arquivo": "prancha-anestesica.html",
     "titulo": "Prancha Anestésica",
     "area": "anestesia-via-aerea", "tema": "Indução e bloqueadores neuromusculares",
     "origem": "Prancha interativa (artefato claude.ai PwrtkWs9M6hGepwGBPmwDH)",
     "secoes": ["O contrato da anestesia geral", "Os cinco indutores venosos",
                "Opioides no intraoperatório", "Curare, a placa e o despertar fraco",
                "A máquina e os olhos", "A consulta que decide a cirurgia",
                "A via aérea difícil", "Anestésicos locais & a intoxicação",
                "Neuroeixo: raqui, peridural e a parede",
                "Sedação: o contínuo sem degraus", "A sala de recuperação",
                "Dor aguda: o mapa e as armas", "Forja: dez decisões",
                "Mesa-mãe: o capítulo em cartões"]},
    {"id": "int-slide-drc", "arquivo": "slide-drc.html",
     "titulo": "Doença Renal Crônica — da fisiologia ao estadiamento",
     "area": "nefrologia", "tema": "Doença renal crônica",
     "origem": "Apresentação interativa empacotada (artefato claude.ai WWA4Bh5WxbvvpEK5AzDgh5)",
     "secoes": ["Introdução: um desafio epidemiológico global",
                "Capítulo 1 — Os rins e a manutenção da homeostase",
                "Capítulo 2 — Fisiopatologia da doença renal crônica",
                "Capítulo 3 — Avaliação da taxa de filtração glomerular",
                "Capítulo 4 — Diagnóstico e classificação (KDIGO, CGA e heat map)"]},
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
