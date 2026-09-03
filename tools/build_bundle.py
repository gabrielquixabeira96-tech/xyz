# -*- coding: utf-8 -*-
"""Empacota a plataforma inteira num único HTML autocontido.

As imagens viram data: URI, o CSS e o JS entram inline. O resultado abre
sozinho, sem servidor e sem a pasta assets/ ao lado.

    python3 tools/build_bundle.py
"""
import base64, os, re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ler(*p):
    return open(os.path.join(RAIZ, *p), encoding="utf-8").read()


css = ler("assets", "css", "app.css")
dados = ler("assets", "data", "conteudo.js")
app = ler("assets", "js", "app.js")

# As imagens entram uma única vez numa tabela; o dataset segue referenciando o
# caminho, que é trocado pelo data: URI na carga. Embutir a URI direto no JSON
# triplicaria o arquivo, porque várias placas se repetem entre os temas.
img_dir = os.path.join(RAIZ, "assets", "img")
tabela = []
for nome in sorted(os.listdir(img_dir)):
    if not nome.endswith(".png"):
        continue
    with open(os.path.join(img_dir, nome), "rb") as f:
        uri = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    tabela.append('"assets/img/%s":"%s"' % (nome, uri))

rehidratar = (
    "window.RM_IMG={" + ",".join(tabela) + "};\n"
    "(function(){var m=window.RM_IMG,d=window.RM_DADOS;\n"
    "  [d.areas,d.temas].forEach(function(l){l.forEach(function(o){if(m[o.img])o.img=m[o.img];});});\n"
    "})();"
)

saida = os.path.join(RAIZ, "dist", "residencia-max.html")
os.makedirs(os.path.dirname(saida), exist_ok=True)
with open(saida, "w", encoding="utf-8") as f:
    f.write(
        '<meta charset="utf-8">\n'
        "<title>Residência Max</title>\n"
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400'
        '&amp;family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&amp;display=swap" rel="stylesheet">\n'
        "<style>\n" + css + "\n</style>\n"
        '<div id="app"></div>\n'
        "<script>\n" + dados + "\n" + rehidratar + "\n</script>\n"
        "<script>\n" + app + "\n</script>\n"
    )
print("→ dist/residencia-max.html (%.1f MB)" % (os.path.getsize(saida) / 1048576))
