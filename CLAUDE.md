# Residência Max — contexto do projeto

Plataforma de estudo de Cirurgia Geral para internos e residentes. Reúne o
material que o autor já produziu (ebook, apresentações, aulas-atlas em HTML,
simulados e deck de repetição espaçada) numa navegação de dois níveis:
**matéria → tema → conteúdo**.

## Como rodar

Não há build, bundler nem dependências. É HTML/CSS/JS puro.

```bash
python3 -m http.server 8000   # http://localhost:8000
```

`index.html` também abre direto do disco (`file://`), porque o conteúdo é
carregado por `<script>` e não por `fetch`.

## Arquitetura

| Caminho | O que é |
| --- | --- |
| `index.html` | shell da página; só carrega o dataset e a aplicação |
| `assets/css/app.css` | design system completo (tokens, shell desktop e mobile) |
| `assets/js/app.js` | a aplicação inteira: roteamento por hash, telas, progresso |
| `assets/data/conteudo.js` | **gerado** — `window.RM_DADOS`. Nunca edite à mão |
| `assets/img/` | 44 placas de fundo dos ladrilhos |
| `assets/interativas/` | aulas-atlas em HTML do autor, servidas em iframe |
| `content-src/` | o material bruto das fontes |
| `tools/taxonomia.py` | matérias, temas e palavras-chave de classificação |
| `tools/build_content.py` | pipeline de ingestão → `assets/data/conteudo.js` |
| `tools/build_bundle.py` | empacota tudo num HTML único em `dist/` |

## Fluxo de trabalho

Para mudar **conteúdo**, edite `content-src/` ou `tools/taxonomia.py` e rode:

```bash
python3 tools/build_content.py    # imprime totais e a quarentena
python3 tools/build_bundle.py     # opcional: dist/residencia-max.html
```

Para mudar **a aplicação**, edite `assets/js/app.js` e `assets/css/app.css`
diretamente — não há etapa de compilação.

## Convenções que o código segue

- **O pipeline transporta conteúdo, não o reescreve.** Enunciados, comentários,
  cartões e slides entram literalmente como estão na fonte. Nada é resumido,
  corrigido, traduzido ou completado na importação. O que não puder ser lido vai
  para `quarentena` e aparece na tela **Acervo** — perda silenciosa é falha do
  build, e o build hoje termina com zero itens em quarentena.
- **Classificação usa conteúdo, não rótulo.** Uma questão é classificada pelo
  enunciado, pelo comentário e pela alternativa correta — nunca pelos
  distratores, que são construídos sobre temas vizinhos de propósito. O rótulo
  do arquivo de origem é só desempate e continua visível na questão.
- **Palavras-chave curtas são perigosas.** A classificação casa substring sem
  acento; `"pia"` casava dentro de "terapia" e `"ecn"` dentro de "técnica". Ao
  acrescentar termos em `taxonomia.py`, prefira expressões de 7+ caracteres e
  confira a distribuição impressa pelo build.
- **Uma matiz de destaque só.** O design usa a rampa de ouro (`--accent*`) e
  opacidades do texto. Sem azul, verde ou vermelho em lugar nenhum.
- **Sem dependências externas** além das fontes do Google Fonts. Nada de npm.
- **O progresso vive no `localStorage`** deste navegador, sob a chave
  `residencia-max/v1`. Não sincroniza entre aparelhos.

## Idioma

Código, comentários, commits e interface em português do Brasil.
