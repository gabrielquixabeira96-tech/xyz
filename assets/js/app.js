/* ==========================================================================
   Residência Max — aplicação
   SPA com roteamento por hash. Sem build, sem dependências: abre por
   file:// ou em qualquer host estático.
   ========================================================================== */
(function () {
  "use strict";

  var D = window.RM_DADOS;
  if (!D) { document.body.innerHTML = "<p style='padding:2rem'>Conteúdo não carregado.</p>"; return; }

  /* ── índices ─────────────────────────────────────────────────────────── */
  var porArea = {}, porTema = {}, aulaPorId = {}, cardPorId = {}, qPorId = {};
  D.areas.forEach(function (a) { porArea[a.slug] = a; });
  D.temas.forEach(function (t) { porTema[t.id] = t; });
  D.aulas.forEach(function (a) { aulaPorId[a.id] = a; });
  D.cards.forEach(function (c) { cardPorId[c.id] = c; });
  D.questoes.forEach(function (q) { qPorId[q.id] = q; });

  var TOTAL = {
    aulas: D.aulas.length, questoes: D.questoes.length,
    cards: D.cards.length, temas: D.temas.length, areas: D.areas.length
  };

  /* ordem de leitura: matéria (peso) → tema → aula. É a espinha do
     anterior/próximo entre temas e entre aulas. */
  var ORDEM_TEMAS = [], ORDEM_AULAS = [], vistoAula = {};
  D.areas.forEach(function (a) {
    a.temas.forEach(function (id) { if (porTema[id]) ORDEM_TEMAS.push(porTema[id]); });
  });
  ORDEM_TEMAS.forEach(function (t) {
    t.aulas.forEach(function (id) {
      var au = aulaPorId[id];
      if (au && !vistoAula[id]) { vistoAula[id] = 1; ORDEM_AULAS.push(au); }
    });
  });
  D.aulas.forEach(function (au) { if (!vistoAula[au.id]) ORDEM_AULAS.push(au); });

  function ehAtlas(au) { return !!au && au.formato === "interativa"; }
  var ATLAS = ORDEM_AULAS.filter(ehAtlas);

  /* ── util ────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function plural(n, um, muitos) { return n + " " + (n === 1 ? um : muitos); }
  function embaralhar(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ── progresso (local, por navegador) ────────────────────────────────── */
  /* O formato salvo é o mesmo desde a v1: só se acrescenta, nunca se renomeia. */
  var CHAVE = "residencia-max/v1";
  function progressoVazio() { return { aulas: {}, questoes: {}, cards: {}, notas: {}, ultimo: null, streak: 0, dias: [] }; }
  var P = progressoVazio();
  try {
    var raw = localStorage.getItem(CHAVE);
    if (raw) {
      var lido = JSON.parse(raw);
      if (lido && typeof lido === "object") P = Object.assign(P, lido);
    }
  } catch (e) { }
  ["aulas", "questoes", "cards", "notas"].forEach(function (k) { if (!P[k] || typeof P[k] !== "object") P[k] = {}; });
  if (!Array.isArray(P.dias)) P.dias = [];

  var salvarPendente = null;
  function salvar() {
    clearTimeout(salvarPendente);
    salvarPendente = setTimeout(function () {
      try { localStorage.setItem(CHAVE, JSON.stringify(P)); } catch (e) { }
    }, 120);
  }
  function marcarDia() {
    var hoje = new Date().toISOString().slice(0, 10);
    if (P.dias[P.dias.length - 1] !== hoje) { P.dias.push(hoje); P.dias = P.dias.slice(-400); }
    var n = 0, d = new Date();
    for (; ;) {
      var s = d.toISOString().slice(0, 10);
      if (P.dias.indexOf(s) === -1) break;
      n++; d.setDate(d.getDate() - 1);
    }
    P.streak = n; salvar();
  }
  var DIA = 864e5, INTERVALOS = [0, 1, 3, 7, 16, 35];
  function estadoCard(id) { return P.cards[id] || { caixa: 0, prox: 0, erros: 0 }; }
  function avaliarCard(id, acertou) {
    var e = estadoCard(id);
    e.caixa = acertou ? Math.min(5, (e.caixa || 0) + 1) : 1;
    if (!acertou) e.erros = (e.erros || 0) + 1;
    e.prox = Date.now() + INTERVALOS[e.caixa] * DIA;
    e.visto = Date.now();
    P.cards[id] = e; marcarDia(); salvar();
  }
  function cardsDevidos() {
    var agora = Date.now();
    return D.cards.filter(function (c) { var e = P.cards[c.id]; return !e || (e.prox || 0) <= agora; });
  }
  function registrarQuestao(id, letra, correta) {
    P.questoes[id] = { r: letra, ok: letra === correta, t: Date.now() };
    marcarDia(); salvar();
  }

  /* progresso 0..1 de um tema / de uma área */
  function totalTema(t) { return t.aulas.length + t.questoes.length + t.cards.length; }
  function progressoTema(t) {
    var total = totalTema(t), feito = 0;
    t.aulas.forEach(function (id) { if (P.aulas[id]) feito++; });
    t.questoes.forEach(function (id) { if (P.questoes[id]) feito++; });
    t.cards.forEach(function (id) { if (P.cards[id]) feito++; });
    return total ? feito / total : 0;
  }
  function progressoArea(a) {
    var total = 0, feito = 0;
    a.temas.forEach(function (id) {
      var t = porTema[id]; if (!t) return;
      total += totalTema(t);
      feito += progressoTema(t) * totalTema(t);
    });
    return total ? feito / total : 0;
  }
  function acertoArea(a) {
    var ok = 0, n = 0;
    a.temas.forEach(function (id) {
      (porTema[id] || { questoes: [] }).questoes.forEach(function (q) {
        var r = P.questoes[q]; if (r) { n++; if (r.ok) ok++; }
      });
    });
    return n ? { pct: Math.round(ok * 100 / n), n: n } : null;
  }

  /* contagem por tipo de conteúdo: o atlas conta à parte das demais aulas */
  function contar(t) {
    var atlas = 0;
    t.aulas.forEach(function (id) { if (ehAtlas(aulaPorId[id])) atlas++; });
    return { atlas: atlas, aulas: t.aulas.length - atlas, questoes: t.questoes.length, cards: t.cards.length };
  }
  function atlasDaArea(a) {
    return ATLAS.filter(function (au) { return au.areaSlug === a.slug || (porTema[au.temaId] || {}).areaSlug === a.slug; });
  }

  /* ── ícones (linha, 1.6px, ~20px) ────────────────────────────────────── */
  var GLIFOS = {
    painel: ["M3 10.5 12 3l9 7.5", "M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5"],
    materias: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    atlas: ["M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z", "M9 4v13.5", "M15 6.5V20"],
    pratica: ["M6 3.8h12a1 1 0 0 1 1 1v15.4a.5.5 0 0 1-.78.42L12 16.4l-6.22 4.22A.5.5 0 0 1 5 20.2V4.8a1 1 0 0 1 1-1Z"],
    cartoes: ["M3 7.5A1.5 1.5 0 0 1 4.5 6h11A1.5 1.5 0 0 1 17 7.5v9A1.5 1.5 0 0 1 15.5 18h-11A1.5 1.5 0 0 1 3 16.5Z", "M7 3h11.5A2.5 2.5 0 0 1 21 5.5V17"],
    busca: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m16.2 16.2 4.3 4.3"],
    acervo: ["M3 5v14", "M7.5 5v14", "M12 5.6v12.8a.6.6 0 0 0 .92.5l9.1-6.4a.6.6 0 0 0 0-1l-9.1-6.4a.6.6 0 0 0-.92.5Z"],
    play: ["M7 4.5v15l12-7.5Z"],
    sino: ["M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"],
    voltar: ["M19 12H5", "m12 19-7-7 7-7"],
    avancar: ["M5 12h14", "m12 5 7 7-7 7"],
    check: ["m20 6-11 11-5-5"],
    x: ["M18 6 6 18", "m6 6 12 12"],
    relogio: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7.5V12l3 2"],
    alvo: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M12 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z"],
    livro: ["M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5Z", "M8 3v18"],
    bisturi: ["M4 20 14.5 9.5", "M14 4.5 19.5 10 15 14 10 9Z"],
    seta: ["m9 5 7 7-7 7"],
    externo: ["M14 4h6v6", "M20 4 11 13", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
    expandir: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
    recolher: ["M9 4v5H4", "M15 4v5h5", "M9 20v-5H4", "M15 20v-5h5"],
    menu: ["M4 7h16", "M4 12h16", "M4 17h16"]
  };
  function icone(nome, tam) {
    var d = GLIFOS[nome] || GLIFOS.alvo, s = tam || 20;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      d.map(function (p) { return '<path d="' + p + '"/>'; }).join("") + "</svg>";
  }
  /* glifo característico por matéria — dá identidade ao ícone da matéria */
  var GLIFO_AREA = {
    coloproctologia: "alvo", perioperatorio: "relogio", "vias-biliares": "bisturi",
    "estomago-duodeno": "alvo", oncologia: "alvo", pancreas: "bisturi", trauma: "alvo",
    hernias: "bisturi", esofago: "bisturi", "apendice-delgado": "bisturi", figado: "alvo",
    etica: "livro", urologia: "bisturi", "endocrino-cp": "alvo", "anestesia-via-aerea": "relogio",
    "baco-transplante": "bisturi", vascular: "alvo", toracica: "bisturi",
    "pele-sarcomas": "bisturi", videolaparoscopia: "alvo", bariatrica: "bisturi",
    pediatrica: "alvo", mama: "alvo", anatomia: "livro", transversais: "livro"
  };

  /* ── ladrilho ────────────────────────────────────────────────────────── */
  function ladrilho(o) {
    var pr = Math.round((o.progresso || 0) * 100);
    var rotulo = o.titulo + (o.dica ? " — " + o.dica : "") + (pr ? " — " + pr + "% visto" : "");
    return '<a class="tile" href="' + esc(o.href) + '" aria-label="' + esc(rotulo) + '" title="' + esc(rotulo) + '">' +
      '<img class="tile-img" src="' + esc(o.img) + '" alt="" loading="lazy">' +
      '<span class="tile-scrim"></span>' +
      (o.glifo ? '<span class="tile-glyph">' + icone(o.glifo, 18) + "</span>" : "") +
      (o.selo ? '<span class="selo selo-tile">' + icone("atlas", 12) + esc(o.selo) + "</span>" : "") +
      '<span class="tile-body">' +
      (o.legenda ? '<span class="tile-cap">' + esc(o.legenda) + (pr ? ' <span class="tile-pct num">· ' + pr + "%</span>" : "") + "</span>" : "") +
      '<span class="tile-title">' + esc(o.titulo) + "</span></span>" +
      '<span class="tile-rail"><i style="width:' + pr + '%"></i></span></a>';
  }

  /* legenda curta do ladrilho: uma unidade só, para caber em tela estreita */
  function legendaTema(t) {
    var c = contar(t);
    if (c.aulas) return plural(c.aulas, "aula", "aulas");
    if (c.questoes) return plural(c.questoes, "questão", "questões");
    if (c.cards) return plural(c.cards, "cartão", "cartões");
    if (c.atlas) return "aula-atlas";
    return "";
  }

  var FORMATOS = {
    ebook: "Aula do ebook", slides: "Apresentação", interativa: "Atlas interativo"
  };

  function rotuloFormato(au) {
    var base = FORMATOS[au.formato || "ebook"] || "Aula";
    if ((au.formato || "ebook") === "ebook" && au.modulo) return base + " · Módulo " + au.modulo;
    if (au.formato === "slides" && au.nSlides) return base + " · " + plural(au.nSlides, "slide", "slides");
    if (ehAtlas(au) && au.secoes && au.secoes.length) return base + " · " + plural(au.secoes.length, "seção", "seções");
    return base;
  }

  /* de onde a questão veio, na linguagem do arquivo de origem */
  function rotuloQuestao(q) {
    return q.areaTexto || q.subtema || q.metaOriginal || (porArea[q.areaSlug] || {}).nome || "";
  }

  function contagemTema(t) {
    var c = contar(t), p = [];
    if (c.atlas) p.push(plural(c.atlas, "atlas", "atlas"));
    if (c.aulas) p.push(plural(c.aulas, "aula", "aulas"));
    if (c.questoes) p.push(plural(c.questoes, "questão", "questões"));
    if (c.cards) p.push(plural(c.cards, "cartão", "cartões"));
    return p.join(" · ");
  }

  /* ── componentes de navegação ────────────────────────────────────────── */
  /* trilha matéria → tema → conteúdo; o último item é a página atual */
  function migalhas(itens) {
    return '<nav class="crumbs" aria-label="Você está em"><ol>' +
      itens.map(function (it, i) {
        var ultimo = i === itens.length - 1;
        return "<li>" + (ultimo || !it.h
          ? '<span aria-current="page">' + esc(it.r) + "</span>"
          : '<a href="' + esc(it.h) + '">' + esc(it.r) + "</a>") + "</li>";
      }).join("") + "</ol></nav>";
  }
  function trilhaTema(t) {
    var a = porArea[t.areaSlug];
    return [{ r: "Matérias", h: "#/materias" }, { r: a ? a.nome : "", h: a ? "#/materia/" + a.slug : "" }, { r: t.nome, h: "#/tema/" + t.id }];
  }

  /* anterior / próximo — cada lado é {h, k (rótulo pequeno), t (título)} */
  function paginador(ant, prox, rotulo) {
    if (!ant && !prox) return "";
    function lado(o, cls, dir) {
      if (!o) return '<span class="pager-vazio"></span>';
      return '<a class="pager-item ' + cls + '" href="' + esc(o.h) + '" rel="' + (dir === "ant" ? "prev" : "next") + '">' +
        '<span class="kicker">' + (dir === "ant" ? icone("voltar", 13) + " Anterior" : "Próximo " + icone("avancar", 13)) +
        (o.k ? " · " + esc(o.k) : "") + "</span>" +
        '<span class="pager-t">' + esc(o.t) + "</span></a>";
    }
    return '<nav class="pager" aria-label="' + esc(rotulo || "Anterior e próximo") + '">' +
      lado(ant, "pager-ant", "ant") + lado(prox, "pager-prox", "prox") + "</nav>";
  }

  /* cartão de atlas — imagem do tema, selo, título e estado */
  function cartaoAtlas(au, compacto) {
    var t = porTema[au.temaId], a = porArea[au.areaSlug] || (t && porArea[t.areaSlug]) || {};
    var visto = !!P.aulas[au.id];
    return '<a class="atlas-card' + (compacto ? " atlas-card-c" : "") + '" href="#/aula/' + esc(au.id) + '">' +
      '<span class="atlas-img"><img src="' + esc(t ? t.img : a.img) + '" alt="" loading="lazy"><span class="tile-scrim"></span>' +
      '<span class="selo">' + icone("atlas", 12) + "Atlas</span></span>" +
      '<span class="atlas-body">' +
      '<span class="kicker kicker-gold">' + esc(a.nome || "") + "</span>" +
      '<span class="atlas-t">' + esc(au.titulo) + "</span>" +
      '<span class="meta italic">' + (au.secoes && au.secoes.length ? plural(au.secoes.length, "seção", "seções") + " · " : "") +
      (visto ? '<span class="estado estado-ok">' + icone("check", 12) + "aberto</span>" : '<span class="estado">novo</span>') +
      "</span></span></a>";
  }

  /* ── navegação ───────────────────────────────────────────────────────── */
  var NAV = [
    { chave: "painel", rotulo: "Painel", href: "#/", glifo: "painel" },
    { chave: "materias", rotulo: "Matérias", href: "#/materias", glifo: "materias" },
    { chave: "atlas", rotulo: "Atlas", href: "#/atlas", glifo: "atlas" },
    { chave: "pratica", rotulo: "Prática", href: "#/pratica", glifo: "pratica" },
    { chave: "cartoes", rotulo: "Cartões", href: "#/cartoes", glifo: "cartoes" },
    { chave: "busca", rotulo: "Buscar", href: "#/busca", glifo: "busca", atalho: "/" },
    { chave: "acervo", rotulo: "Acervo", href: "#/acervo", glifo: "acervo" }
  ];
  var TABBAR = ["painel", "materias", "atlas", "pratica", "cartoes"];
  var secaoAtual = "painel";

  function irPara(href) {
    if (location.hash === href) render(true); else location.hash = href;
  }

  /* ── shell ───────────────────────────────────────────────────────────── */
  var raiz = document.getElementById("app") || document.body;
  var MARCA = '<span class="brand-mark">' +
    '<svg width="11" height="12" viewBox="0 0 11 12" fill="#131211" aria-hidden="true"><path d="M1 1.2v9.6a.6.6 0 0 0 .92.5l7.6-4.8a.6.6 0 0 0 0-1L1.92.7A.6.6 0 0 0 1 1.2Z"/></svg>' +
    '</span><span class="brand-name">Residência<span>Max</span></span>';

  function montarShell() {
    raiz.innerHTML =
      '<a class="skip" href="#tela">Pular para o conteúdo</a>' +
      '<div class="shell">' +
      '<aside class="sidebar">' +
      '<a class="brand" href="#/" aria-label="Residência Max — painel">' + MARCA + "</a>" +
      '<nav class="nav" id="nav-desktop" aria-label="Navegação principal"></nav>' +
      '<div id="side-cont"></div>' +
      '<div class="side-block"><span class="kicker">Sequência</span>' +
      '<div class="streak"><b class="num" id="streak">0</b><span class="meta italic">dias seguidos de estudo</span></div></div>' +
      '<div class="side-user"><span class="avatar" aria-hidden="true">GB</span><span class="meta">Gabriel Bezerra<br><span class="italic">R+ Cirurgia Geral</span></span></div>' +
      "</aside>" +
      '<div class="col-main">' +
      '<header class="topbar">' +
      '<a class="brand" href="#/" aria-label="Residência Max — painel">' + MARCA + "</a>" +
      '<div class="topbar-acoes">' +
      '<a class="icon-btn" href="#/busca" aria-label="Buscar">' + icone("busca", 21) + "</a>" +
      '<button class="icon-btn" id="abrir-menu" aria-label="Mais opções" aria-expanded="false" aria-controls="menu-sheet">' + icone("menu", 22) + "</button>" +
      "</div></header>" +
      '<main class="main" id="tela" tabindex="-1"></main>' +
      "</div></div>" +
      '<div class="dock"><div id="mini"></div><nav class="tabbar" id="nav-mobile" aria-label="Navegação principal"></nav></div>' +
      '<div class="sheet" id="menu-sheet" hidden>' +
      '<div class="sheet-fundo" data-fechar-menu></div>' +
      '<div class="sheet-painel" role="dialog" aria-modal="true" aria-label="Menu">' +
      '<div class="sheet-topo"><span class="kicker">Navegar</span>' +
      '<button class="icon-btn" data-fechar-menu aria-label="Fechar menu">' + icone("x", 20) + "</button></div>" +
      '<nav id="nav-sheet" aria-label="Todas as seções"></nav>' +
      '<div class="sheet-streak"><b class="num" id="streak-m">0</b><span class="meta italic">dias seguidos de estudo</span></div>' +
      "</div></div>";

    document.getElementById("nav-desktop").innerHTML = NAV.map(function (n, i) {
      return '<a class="nav-item" data-nav="' + n.chave + '" href="' + n.href + '">' +
        '<span class="idx num">' + ("0" + (i + 1)) + "</span>" + icone(n.glifo, 19) +
        "<span>" + n.rotulo + "</span>" +
        (n.chave === "atlas" && ATLAS.length ? '<span class="nav-n num">' + ATLAS.length + "</span>" : "") +
        (n.atalho ? '<kbd class="kbd" aria-hidden="true">' + n.atalho + "</kbd>" : "") + "</a>";
    }).join("");

    document.getElementById("nav-mobile").innerHTML = TABBAR.map(function (k) {
      var n = NAV.filter(function (x) { return x.chave === k; })[0];
      return '<a data-nav="' + n.chave + '" href="' + n.href + '">' +
        icone(n.glifo, 21) + "<span>" + n.rotulo + "</span></a>";
    }).join("");

    document.getElementById("nav-sheet").innerHTML = NAV.map(function (n) {
      return '<a class="nav-item" data-nav="' + n.chave + '" href="' + n.href + '">' + icone(n.glifo, 19) +
        "<span>" + n.rotulo + "</span>" +
        (n.chave === "atlas" && ATLAS.length ? '<span class="nav-n num">' + ATLAS.length + "</span>" : "") + "</a>";
    }).join("");

    raiz.addEventListener("click", function (ev) {
      if (ev.target.closest(".skip")) {
        ev.preventDefault();
        document.getElementById("tela").focus();
        return;
      }
      var alvo = ev.target.closest("[data-ir]");
      if (alvo) { ev.preventDefault(); irPara(alvo.getAttribute("data-ir")); }
    });
  }

  function abrirMenu(abrir) {
    var s = document.getElementById("menu-sheet"), b = document.getElementById("abrir-menu");
    if (!s) return;
    s.hidden = !abrir;
    b.setAttribute("aria-expanded", String(abrir));
    document.body.classList.toggle("travado", abrir);
    if (abrir) { var f = s.querySelector("[aria-current]") || s.querySelector("a"); if (f) f.focus(); }
    else b.focus({ preventScroll: true });
  }

  /* o "continuar" resolve imagem e rótulo pelo endereço na hora de mostrar —
     assim o registro salvo fica pequeno e progresso antigo continua válido */
  function resolverUltimo(u) {
    if (!u || !u.href) return null;
    var out = { href: u.href, titulo: u.titulo, meta: u.meta, img: u.img };
    var m;
    if ((m = u.href.match(/^#\/aula\/([^?]+)/))) {
      var au = aulaPorId[decodeURIComponent(m[1])];
      if (!au) return null;
      var t = porTema[au.temaId], a = porArea[au.areaSlug];
      out.titulo = au.titulo; out.meta = rotuloFormato(au) + (a ? " · " + a.nome : "");
      out.img = t ? t.img : a ? a.img : out.img; out.atlas = ehAtlas(au);
    } else if ((m = u.href.match(/[?&]q=([^&]+)/)) && qPorId[decodeURIComponent(m[1])]) {
      var q = qPorId[decodeURIComponent(m[1])], tq = porTema[q.temaId];
      out.img = tq ? tq.img : (porArea[q.areaSlug] || {}).img || out.img;
    } else if ((m = u.href.match(/^#\/tema\/([^?]+)/)) && porTema[decodeURIComponent(m[1])]) {
      out.img = porTema[decodeURIComponent(m[1])].img;
    } else if ((m = u.href.match(/^#\/materia\/([^?]+)/)) && porArea[m[1]]) {
      out.img = porArea[m[1]].img;
    } else if ((m = u.href.match(/[?&]tema=([^&]+)/)) && porTema[decodeURIComponent(m[1])]) {
      out.img = porTema[decodeURIComponent(m[1])].img;
    } else if ((m = u.href.match(/[?&]area=([^&]+)/)) && porArea[decodeURIComponent(m[1])]) {
      out.img = porArea[decodeURIComponent(m[1])].img;
    }
    if (!out.img) out.img = D.areas[0].img;
    return out;
  }

  function atualizarShell() {
    var sq = P.streak || 0;
    document.getElementById("streak").textContent = sq;
    document.getElementById("streak-m").textContent = sq;
    Array.prototype.forEach.call(document.querySelectorAll("[data-nav]"), function (b) {
      if (b.getAttribute("data-nav") === secaoAtual) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    var mini = document.getElementById("mini"), side = document.getElementById("side-cont");
    var u = resolverUltimo(P.ultimo);
    /* nada de oferecer "continuar" para a página em que você já está */
    var aqui = u && location.hash === u.href;
    if (!u || aqui || secaoAtual === "painel" || secaoAtual === "pratica" || secaoAtual === "cartoes") { mini.innerHTML = ""; }
    else {
      mini.innerHTML = '<a class="miniplayer" href="' + esc(u.href) + '" aria-label="Continuar: ' + esc(u.titulo) + '">' +
        '<img src="' + esc(u.img) + '" alt="">' +
        '<span class="mp-t"><b>' + esc(u.titulo) + "</b><span>" + esc(u.meta || "") + "</span></span>" +
        '<span class="mp-play">' + icone("play", 17) + "</span></a>";
    }
    side.innerHTML = (!u || aqui) ? "" :
      '<a class="side-cont" href="' + esc(u.href) + '"><span class="kicker">Continuar de onde parei</span>' +
      '<span class="side-cont-t">' + esc(u.titulo) + "</span>" +
      '<span class="meta italic">' + esc(u.meta || "") + "</span></a>";
    document.body.classList.toggle("sem-mini", !mini.innerHTML);
  }

  function lembrar(href, titulo, meta) {
    P.ultimo = { href: href, titulo: titulo, meta: meta }; salvar();
  }

  /* ── telas ───────────────────────────────────────────────────────────── */
  function saudacao() {
    var h = new Date().getHours();
    return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  }

  function telaPainel() {
    secaoAtual = "painel";
    document.title = "Residência Max — Painel";
    var respondidas = Object.keys(P.questoes).filter(function (k) { return qPorId[k]; }).length;
    var certas = Object.keys(P.questoes).filter(function (k) { return qPorId[k] && P.questoes[k].ok; }).length;
    var taxa = respondidas ? Math.round(certas * 100 / respondidas) : 0;
    var devidos = cardsDevidos().length;
    var lidas = Object.keys(P.aulas).filter(function (k) { return aulaPorId[k]; }).length;
    var u = resolverUltimo(P.ultimo);

    /* lacunas: áreas com pior aproveitamento, depois as menos vistas */
    var lacunas = D.areas.map(function (a) {
      var ac = acertoArea(a), pr = progressoArea(a);
      return { a: a, pct: ac ? ac.pct : null, n: ac ? ac.n : 0, pr: pr };
    }).sort(function (x, y) {
      if (x.pct === null && y.pct === null) return x.pr - y.pr || y.a.peso - x.a.peso;
      if (x.pct === null) return 1;
      if (y.pct === null) return -1;
      return x.pct - y.pct;
    }).slice(0, 5);

    var recomendados = D.areas.slice().sort(function (x, y) {
      return (progressoArea(x) - progressoArea(y)) || (y.peso - x.peso);
    }).slice(0, 6);

    /* atlas: os ainda não abertos primeiro, depois na ordem de leitura */
    var atlasPainel = ATLAS.slice().sort(function (x, y) { return (P.aulas[x.id] ? 1 : 0) - (P.aulas[y.id] ? 1 : 0); }).slice(0, 4);

    var html =
      '<section class="split">' +
      "<div>" +
      '<h1 class="display">' + saudacao() + ", Gabriel.</h1>" +
      '<p class="prose narrow" style="margin-top:var(--s4)">Todo o material que você produziu está reunido aqui: ' +
      TOTAL.aulas + " aulas — do ebook, das suas apresentações e " + plural(ATLAS.length, "aula-atlas interativa", "aulas-atlas interativas") + " —, " +
      TOTAL.questoes + " questões comentadas e " + TOTAL.cards + " cartões de repetição espaçada, " +
      "distribuídos em " + TOTAL.areas + " matérias e " + TOTAL.temas +
      " temas. A ordem das matérias segue o peso previsto para a prova de 2027 pela sua própria análise de padrões 2021–2026.</p>" +
      (u ? '<a class="continuar" href="' + esc(u.href) + '">' +
        '<img src="' + esc(u.img) + '" alt="" loading="lazy">' +
        '<span class="continuar-t"><span class="kicker kicker-gold">Continuar de onde parei' + (u.atlas ? " · atlas" : "") + "</span>" +
        "<b>" + esc(u.titulo) + "</b>" +
        '<span class="meta italic">' + esc(u.meta || "") + "</span></span>" +
        '<span class="continuar-play">' + icone("play", 18) + "</span></a>" : "") +
      '<div class="acoes" style="margin-top:var(--s5)">' +
      '<a class="btn btn-primary" href="#/pratica">Iniciar sessão de prática</a>' +
      '<a class="btn" href="#/materias">Ver as matérias</a>' +
      (ATLAS.length ? '<a class="btn" href="#/atlas">' + icone("atlas", 16) + "Atlas interativos</a>" : "") + "</div></div>" +

      '<div class="split-aside">' +
      '<span class="kicker">O que a prova pede</span>' +
      '<div style="margin-top:var(--s3)">' +
      D.areas.slice(0, 4).map(function (a, i) {
        return '<a class="peso-linha" href="#/materia/' + a.slug + '">' +
          '<span><span class="peso-nome">' + esc(a.nome) + "</span>" +
          '<span class="meta italic">' + esc(a.subtitulo) + "</span></span>" +
          '<b class="num peso-n' + (i === 0 ? " gold" : "") + '">' + a.peso + "</b></a>";
      }).join("") +
      '<p class="meta italic" style="margin-top:var(--s3)">Questões esperadas em 80, pela análise de padrões 2021–2026.</p>' +
      "</div></div></section>" +

      '<section class="statstrip" style="margin-top:var(--s7)" aria-label="Seus números">' +
      stat("Questões respondidas", respondidas, TOTAL.questoes + " no banco", respondidas > 0) +
      stat("Taxa de acerto", respondidas ? taxa + "%" : "—", respondidas ? "em " + respondidas + " questões" : "responda para medir", taxa >= 70) +
      stat("Aulas vistas", lidas, "de " + TOTAL.aulas + " — ebook, slides e atlas", lidas > 0) +
      stat("Cartões devidos", devidos, devidos ? "prontos para revisar agora" : "nada vencido hoje", devidos > 0) +
      "</section>" +

      (ATLAS.length ?
        '<section style="margin-top:var(--s7)" aria-labelledby="h-atlas">' +
        '<div class="section-head"><div><span class="kicker kicker-gold">' + icone("atlas", 12) + " Aulas-atlas interativas</span>" +
        '<h2 id="h-atlas" style="margin-top:4px">Atlas para abrir em tela cheia</h2></div>' +
        '<a class="link-sec" href="#/atlas">' + plural(ATLAS.length, "atlas", "atlas") + " · ver todos " + icone("seta", 14) + "</a></div>" +
        '<div class="atlas-grid">' + atlasPainel.map(function (au) { return cartaoAtlas(au); }).join("") + "</div></section>" : "") +

      '<section class="split split-b" style="margin-top:var(--s7)">' +
      "<div>" +
      '<div class="section-head"><h2>Matérias essenciais</h2>' +
      '<a class="link-sec" href="#/materias">' + TOTAL.areas + " matérias · ver a grade " + icone("seta", 14) + "</a></div>" +
      '<div class="tiles tiles-3">' + recomendados.map(function (a) {
        var na = atlasDaArea(a).length;
        return ladrilho({
          href: "#/materia/" + a.slug, img: a.img, titulo: a.nome,
          legenda: plural(a.temas.length, "tema", "temas"), selo: na ? plural(na, "atlas", "atlas") : "",
          progresso: progressoArea(a), glifo: GLIFO_AREA[a.slug]
        });
      }).join("") + "</div></div>" +

      '<div><div class="section-head"><h3>Mapa de lacunas</h3></div>' +
      lacunas.map(function (l, i) {
        var pct = l.pct === null ? Math.round(l.pr * 100) : l.pct;
        return '<a class="rank" href="#/materia/' + l.a.slug + '">' +
          '<span class="rank-idx num">' + ("0" + (i + 1)) + "</span>" +
          '<span style="flex:1;min-width:0"><span class="rank-nome">' + esc(l.a.nome) + "</span>" +
          '<span class="meta italic" style="display:block">' +
          (l.pct === null ? "ainda sem questões respondidas — " + Math.round(l.pr * 100) + "% do material visto"
            : l.n + " questões respondidas") + "</span>" +
          '<span class="bar"><i style="width:' + pct + '%"></i></span></span>' +
          '<b class="rank-pct num' + (l.pct === null ? "" : " gold") + '">' + pct + "%</b></a>";
      }).join("") +
      '<a class="btn btn-primary btn-block" style="margin-top:var(--s4)" href="#/pratica?area=' + lacunas[0].a.slug + '">Praticar a maior lacuna</a>' +
      "</div></section>" +

      '<section style="margin-top:var(--s7)">' +
      '<div class="section-head"><h3>Mapa de calor por matéria</h3>' +
      '<span class="meta italic">cada quadrado é um tema</span></div>' +
      D.areas.map(function (a) {
        return '<div class="heat-row"><a class="heat-nome" href="#/materia/' + a.slug + '">' + esc(a.nome) + "</a>" +
          '<span class="heat-cells">' + a.temas.map(function (id) {
            var t = porTema[id]; if (!t) return "";
            var p = progressoTema(t);
            var cor = p >= .9 ? "transparent" : p >= .6 ? "var(--tint-1)" : p >= .3 ? "var(--tint-2)" : p > 0 ? "var(--tint-3)" : "var(--tint-4)";
            var rot = t.nome + " — " + Math.round(p * 100) + "% visto";
            return '<a class="heat-cell" style="background:' + cor + '" href="#/tema/' + esc(t.id) +
              '" title="' + esc(rot) + '" aria-label="' + esc(rot) + '"></a>';
          }).join("") + "</span></div>";
      }).join("") +
      '<div class="heat-legend" aria-hidden="true"><span>Domínio</span>' +
      ["transparent", "var(--tint-1)", "var(--tint-2)", "var(--tint-3)", "var(--tint-4)"].map(function (c) {
        return '<i style="background:' + c + '"></i>';
      }).join("") + "<span>Lacuna</span></div></section>" +

      '<section style="margin-top:var(--s7)">' +
      '<div class="section-head"><h3>Próximos passos</h3></div>' +
      '<div class="grid-cards">' + proximosPassos().map(function (c) {
        return '<a class="card card-link card-img" href="' + esc(c.href) + '">' +
          '<img src="' + esc(c.img) + '" alt="" loading="lazy">' +
          '<span class="card-pad">' +
          '<span class="kicker kicker-gold">' + esc(c.kicker) + "</span>" +
          '<span class="card-t">' + esc(c.titulo) + "</span>" +
          '<span class="card-d">' + esc(c.corpo) + "</span></span></a>";
      }).join("") + "</div></section>";

    return html;
  }

  function stat(rotulo, valor, nota, dourado) {
    return "<div><span class=\"kicker\">" + esc(rotulo) + "</span>" +
      '<div class="stat-n num' + (dourado ? " gold" : "") + '">' + esc(valor) + "</div>" +
      '<span class="meta italic">' + esc(nota) + "</span></div>";
  }

  function proximosPassos() {
    var out = [];
    var devidos = cardsDevidos();
    if (devidos.length) {
      var a1 = porArea[devidos[0].areaSlug];
      out.push({
        href: "#/cartoes", img: a1 ? a1.img : D.areas[0].img, kicker: "Repetição espaçada",
        titulo: plural(devidos.length, "cartão devido", "cartões devidos"),
        corpo: "A fila de revisão usa as cinco caixas de Leitner: 1, 3, 7, 16 e 35 dias."
      });
    }
    var naoLida = ORDEM_AULAS.filter(function (a) { return !P.aulas[a.id]; })[0];
    if (naoLida) {
      var ta = porTema[naoLida.temaId];
      out.push({
        href: "#/aula/" + naoLida.id, img: ta ? ta.img : D.areas[0].img, kicker: ehAtlas(naoLida) ? "Atlas ainda não aberto" : "Continuar a leitura",
        titulo: naoLida.titulo, corpo: rotuloFormato(naoLida) + " — " + (porArea[naoLida.areaSlug] || {}).nome
      });
    }
    var naoResp = D.questoes.filter(function (q) { return !P.questoes[q.id]; })[0];
    if (naoResp) {
      var t2 = porTema[naoResp.temaId];
      out.push({
        href: "#/pratica?q=" + encodeURIComponent(naoResp.id), img: t2 ? t2.img : D.areas[0].img,
        kicker: naoResp.colecao || "Questões comentadas",
        titulo: "Questão " + naoResp.n + " — " + rotuloQuestao(naoResp),
        corpo: "Gabarito comentado, análise dos distratores e a lacuna que a questão testa."
      });
    }
    return out.slice(0, 3);
  }

  /* ── matérias ────────────────────────────────────────────────────────── */
  var filtroMateria = "todas";
  function telaMaterias() {
    secaoAtual = "materias";
    document.title = "Matérias — Residência Max";
    var grupos = {
      todas: function () { return true; },
      nucleo: function (a) { return a.peso >= 4; },
      baratos: function (a) { return a.peso >= 2 && a.peso < 4; },
      cauda: function (a) { return a.peso < 2; },
      atlas: function (a) { return atlasDaArea(a).length > 0; }
    };
    var rotulos = { todas: "Todas", nucleo: "Camada 1 · Núcleo", baratos: "Camada 2 · Baratos", cauda: "Camada 3 · Cauda" };
    var comAtlas = D.areas.filter(grupos.atlas).length;
    if (comAtlas) rotulos.atlas = "Com atlas";
    if (!rotulos[filtroMateria]) filtroMateria = "todas";
    var lista = D.areas.filter(grupos[filtroMateria] || grupos.todas);

    return '<div class="section-head"><div>' +
      '<span class="kicker">O acervo, matéria por matéria</span>' +
      '<h1 class="h-pagina">Escolha uma matéria</h1></div>' +
      '<span class="meta num" aria-live="polite">' + lista.length + " de " + TOTAL.areas + "</span></div>" +
      '<p class="prose" style="margin-bottom:var(--s5)">As camadas são as do seu plano de ataque: a Camada 1 concentra cerca de 59% das questões, ' +
      "a Camada 2 é o material de alto retorno por hora estudada, e a Camada 3 é a cauda longa, onde basta o padrão-ouro de cada tema.</p>" +
      '<div class="chips" role="group" aria-label="Filtrar matérias" style="margin-bottom:var(--s5)">' +
      Object.keys(rotulos).map(function (k) {
        var n = D.areas.filter(grupos[k]).length;
        return '<button class="chip" data-filtro="' + k + '" aria-pressed="' + (filtroMateria === k) + '">' +
          (k === "atlas" ? icone("atlas", 13) : "") + rotulos[k] + ' <span class="chip-n num">' + n + "</span></button>";
      }).join("") + "</div>" +
      '<div class="tiles tiles-6">' + lista.map(function (a) {
        var na = atlasDaArea(a).length;
        return ladrilho({
          href: "#/materia/" + a.slug, img: a.img, titulo: a.nome,
          legenda: plural(a.temas.length, "tema", "temas"), selo: na ? plural(na, "atlas", "atlas") : "",
          dica: a.subtitulo, progresso: progressoArea(a), glifo: GLIFO_AREA[a.slug]
        });
      }).join("") + "</div>";
  }

  function telaMateria(slug) {
    secaoAtual = "materias";
    var a = porArea[slug];
    if (!a) return vazio("Matéria não encontrada.");
    document.title = a.nome + " — Residência Max";
    var temas = a.temas.map(function (id) { return porTema[id]; }).filter(Boolean);
    var ac = acertoArea(a), atlas = atlasDaArea(a);
    var i = D.areas.indexOf(a), ant = D.areas[i - 1], prox = D.areas[i + 1];

    return migalhas([{ r: "Matérias", h: "#/materias" }, { r: a.nome }]) +
      '<div class="section-head cab-pagina"><div>' +
      '<span class="kicker">' + esc(a.sigla) + " · " + esc(a.subtitulo) + "</span>" +
      '<h1 class="h-pagina h-grande">' + esc(a.nome) + "</h1>" +
      '<span class="meta italic">' + Math.round(progressoArea(a) * 100) + "% do material visto</span></div>" +
      '<div class="acoes">' +
      (a.nQuestoes ? '<a class="btn btn-sm btn-primary" href="#/pratica?area=' + a.slug + '">Praticar esta matéria</a>' : "") +
      (a.nCards ? '<a class="btn btn-sm" href="#/cartoes?area=' + a.slug + '">Revisar os cartões</a>' : "") +
      "</div></div>" +
      '<div class="statstrip" style="margin-bottom:var(--s6)">' +
      stat("Temas", a.temas.length, "nesta matéria", false) +
      stat("Aulas", a.nAulas, atlas.length ? "incluindo " + plural(atlas.length, "atlas", "atlas") : "ebook e apresentações", atlas.length > 0) +
      stat("Questões", a.nQuestoes, "com gabarito comentado", false) +
      stat("Acerto", ac ? ac.pct + "%" : "—", ac ? "em " + ac.n + " respondidas" : "ainda não praticado", !!ac) +
      "</div>" +
      (atlas.length ?
        '<section aria-labelledby="h-atlas-m" style="margin-bottom:var(--s6)">' +
        '<div class="section-head"><h2 id="h-atlas-m" class="h-sec">' + icone("atlas", 18) + " Atlas interativos " +
        '<span class="meta num">(' + atlas.length + ")</span></h2></div>" +
        '<div class="atlas-grid">' + atlas.map(function (au) { return cartaoAtlas(au); }).join("") + "</div></section>" : "") +
      '<div class="section-head"><h2 class="h-sec">Temas</h2><span class="meta">' + plural(temas.length, "tema", "temas") + "</span></div>" +
      '<div class="tiles tiles-4">' + temas.map(function (t) {
        var c = contar(t);
        return ladrilho({
          href: "#/tema/" + t.id, img: t.img, titulo: t.nome,
          legenda: legendaTema(t), dica: contagemTema(t), progresso: progressoTema(t),
          selo: c.atlas ? "Atlas" : "",
          glifo: c.aulas ? "livro" : c.questoes ? "pratica" : c.cards ? "cartoes" : "atlas"
        });
      }).join("") + "</div>" +
      paginador(ant && { h: "#/materia/" + ant.slug, k: "matéria", t: ant.nome },
        prox && { h: "#/materia/" + prox.slug, k: "matéria", t: prox.nome }, "Matéria anterior e próxima");
  }

  /* ── tema ────────────────────────────────────────────────────────────── */
  function telaTema(id, par) {
    secaoAtual = "materias";
    var t = porTema[id];
    if (!t) return vazio("Tema não encontrado.");
    var a = porArea[t.areaSlug] || { nome: "", slug: "" };
    document.title = t.nome + " — Residência Max";
    var c = contar(t);
    var atlas = t.aulas.map(function (x) { return aulaPorId[x]; }).filter(ehAtlas);
    var aulas = t.aulas.map(function (x) { return aulaPorId[x]; }).filter(function (au) { return au && !ehAtlas(au); });

    /* abas por tipo de conteúdo — só aparecem as que têm material */
    var abas = [{ k: "tudo", r: "Tudo", n: totalTema(t) }];
    if (c.atlas) abas.push({ k: "atlas", r: "Atlas", n: c.atlas, g: "atlas" });
    if (c.aulas) abas.push({ k: "aulas", r: "Aulas", n: c.aulas, g: "livro" });
    if (c.questoes) abas.push({ k: "questoes", r: "Questões", n: c.questoes, g: "pratica" });
    if (c.cards) abas.push({ k: "cartoes", r: "Cartões", n: c.cards, g: "cartoes" });
    var ver = (par && par.ver) || "tudo";
    if (!abas.some(function (x) { return x.k === ver; })) ver = "tudo";
    function mostra(k) { return ver === "tudo" || ver === k; }

    var i = ORDEM_TEMAS.indexOf(t), ant = ORDEM_TEMAS[i - 1], prox = ORDEM_TEMAS[i + 1];
    var pr = Math.round(progressoTema(t) * 100);

    var html = migalhas([{ r: "Matérias", h: "#/materias" }, { r: a.nome, h: "#/materia/" + a.slug }, { r: t.nome }]) +
      '<header class="tema-cab">' +
      '<img class="tema-cab-img" src="' + esc(t.img) + '" alt="">' +
      '<div class="tema-cab-txt">' +
      '<span class="kicker">' + esc(a.nome) + "</span>" +
      '<h1 class="h-pagina h-grande">' + esc(t.nome) + "</h1>" +
      '<span class="meta italic">' + esc(contagemTema(t) || "sem material vinculado") + "</span>" +
      '<div class="tema-prog" aria-label="' + pr + '% do tema visto"><span class="bar"><i style="width:' + pr + '%"></i></span><span class="meta num">' + pr + "% visto</span></div>" +
      "</div>" +
      '<div class="acoes tema-acoes">' +
      (atlas.length ? '<a class="btn btn-sm btn-primary" href="#/aula/' + esc(atlas[0].id) + '">' + icone("atlas", 15) + "Abrir o atlas</a>" : "") +
      (t.questoes.length ? '<a class="btn btn-sm' + (atlas.length ? "" : " btn-primary") + '" href="#/pratica?tema=' + esc(t.id) + '">Praticar o tema</a>' : "") +
      (t.cards.length ? '<a class="btn btn-sm" href="#/cartoes?tema=' + esc(t.id) + '">Revisar cartões</a>' : "") +
      "</div></header>";

    if (abas.length > 2) {
      html += '<nav class="abas" aria-label="Filtrar por tipo de conteúdo">' + abas.map(function (x) {
        return '<a class="aba" href="#/tema/' + esc(t.id) + (x.k === "tudo" ? "" : "?ver=" + x.k) + '"' +
          (x.k === ver ? ' aria-current="true"' : "") + ">" + (x.g ? icone(x.g, 14) : "") + x.r +
          ' <span class="num chip-n">' + x.n + "</span></a>";
      }).join("") + "</nav>";
    }

    if (atlas.length && mostra("atlas")) {
      html += '<section class="bloco" aria-labelledby="h-t-atlas"><h2 id="h-t-atlas" class="h-sec">' + icone("atlas", 18) + " Atlas interativo" + (atlas.length > 1 ? "s" : "") + "</h2>" +
        atlas.map(function (au) {
          var visto = !!P.aulas[au.id];
          return '<div class="atlas-destaque">' +
            '<a class="atlas-destaque-img" href="#/aula/' + esc(au.id) + '" tabindex="-1" aria-hidden="true"><img src="' + esc(t.img) + '" alt="" loading="lazy"><span class="tile-scrim"></span>' +
            '<span class="selo">' + icone("atlas", 12) + "Atlas</span></a>" +
            '<div class="atlas-destaque-txt">' +
            '<span class="kicker kicker-gold">' + esc(rotuloFormato(au)) + (visto ? " · aberto" : " · novo") + "</span>" +
            '<a class="atlas-t" href="#/aula/' + esc(au.id) + '">' + esc(au.titulo) + "</a>" +
            (au.origem ? '<span class="meta italic">' + esc(au.origem) + "</span>" : "") +
            (au.secoes && au.secoes.length ? '<ol class="secoes">' + au.secoes.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" : "") +
            '<div class="acoes">' +
            '<a class="btn btn-sm btn-primary" href="#/aula/' + esc(au.id) + '">' + icone("expandir", 15) + "Abrir o atlas</a>" +
            (au.src ? '<a class="btn btn-sm" href="' + esc(au.src) + '" target="_blank" rel="noopener">' + icone("externo", 15) + 'Nova aba<span class="sr"> (abre em nova aba)</span></a>' : "") +
            "</div></div></div>";
        }).join("") + "</section>";
    }

    if (aulas.length && mostra("aulas")) {
      html += '<section class="bloco" aria-labelledby="h-t-aulas"><h2 id="h-t-aulas" class="h-sec">Aulas <span class="meta num">(' + aulas.length + ")</span></h2>" +
        '<div class="grid-cards">' +
        aulas.map(function (au) {
          var lida = !!P.aulas[au.id];
          return '<a class="card card-link" href="#/aula/' + esc(au.id) + '">' +
            '<span class="kicker kicker-gold">' + esc(rotuloFormato(au)) + "</span>" +
            '<span class="card-t">' + esc(au.titulo) + "</span>" +
            '<span class="estado' + (lida ? " estado-ok" : "") + '">' + (lida ? icone("check", 12) + "lida" : "não lida") + "</span></a>";
        }).join("") + "</div></section>";
    }
    if (t.questoes.length && mostra("questoes")) {
      var resp = t.questoes.filter(function (q) { return P.questoes[q]; }).length;
      html += '<section class="bloco" aria-labelledby="h-t-q"><div class="section-head"><h2 id="h-t-q" class="h-sec">Questões comentadas <span class="meta num">(' + t.questoes.length + ")</span></h2>" +
        '<span class="meta num">' + resp + " respondidas</span></div>" +
        t.questoes.map(function (qid) {
          var q = qPorId[qid], r = P.questoes[qid];
          if (!q) return "";
          return '<a class="hit" href="#/pratica?q=' + encodeURIComponent(qid) + '">' +
            '<span class="kicker kicker-gold">Questão ' + q.n + " · " + esc(rotuloQuestao(q)) + "</span>" +
            '<span class="hit-t hit-corpo">' + esc(q.enunciado.slice(0, 190)) + (q.enunciado.length > 190 ? "…" : "") + "</span>" +
            '<span class="estado' + (r && r.ok ? " estado-ok" : "") + '">' + (r ? (r.ok ? icone("check", 12) + "acertou" : icone("x", 12) + "errou — refaça") : "não respondida") + "</span></a>";
        }).join("") + "</section>";
    }
    if (t.cards.length && mostra("cartoes")) {
      html += '<section class="bloco" aria-labelledby="h-t-c"><div class="section-head"><h2 id="h-t-c" class="h-sec">Cartões de memória <span class="meta num">(' + t.cards.length + ")</span></h2>" +
        '<a class="btn btn-sm" href="#/cartoes?tema=' + esc(t.id) + '">Revisar estes cartões</a></div>' +
        t.cards.map(function (cid) {
          var cc = cardPorId[cid], e = P.cards[cid];
          if (!cc) return "";
          return '<details class="card cartao-lista"><summary>' +
            "<span>" + esc(cc.frente) + "</span>" + (e ? ' <span class="meta num">caixa ' + e.caixa + "</span>" : "") +
            '</summary><p class="cartao-verso">' + esc(cc.verso) + "</p>" +
            '<p class="meta italic" style="margin:var(--s2) 0 0">Deck de origem: ' + esc(cc.deck) + "</p></details>";
        }).join("") + "</section>";
    }
    if (!totalTema(t)) {
      html += '<div class="vazio-bloco"><p class="prose">Este tema ainda não tem material vinculado no acervo.</p></div>';
    }
    html += paginador(ant && { h: "#/tema/" + ant.id, k: ant.areaSlug !== t.areaSlug ? (porArea[ant.areaSlug] || {}).nome : "tema", t: ant.nome },
      prox && { h: "#/tema/" + prox.id, k: prox.areaSlug !== t.areaSlug ? (porArea[prox.areaSlug] || {}).nome : "tema", t: prox.nome }, "Tema anterior e próximo");
    return html;
  }

  /* ── atlas (todas as aulas interativas) ──────────────────────────────── */
  function telaAtlas(par) {
    secaoAtual = "atlas";
    document.title = "Atlas interativos — Residência Max";
    var abertos = ATLAS.filter(function (au) { return P.aulas[au.id]; }).length;
    var areas = D.areas.filter(function (a) { return atlasDaArea(a).length; });
    var sel = par && par.area && porArea[par.area] ? par.area : "";
    var html = '<span class="kicker kicker-gold">' + icone("atlas", 12) + " Aulas-atlas interativas</span>" +
      '<h1 class="display" style="margin-top:4px">Atlas</h1>' +
      '<p class="prose" style="margin-top:var(--s4)">As aulas-atlas em HTML que você produziu, com pranchas, fluxogramas e algoritmos navegáveis. ' +
      "Cada uma abre aqui dentro, em tela cheia ou numa aba própria — e conta como aula vista no tema a que pertence.</p>";
    if (!ATLAS.length) {
      return html + '<div class="vazio-bloco"><p class="prose">Nenhum atlas interativo foi importado ainda. Quando houver, eles aparecem aqui, na matéria e no tema correspondentes.</p></div>';
    }
    html += '<div class="statstrip statstrip-3" style="margin:var(--s5) 0">' +
      stat("Atlas", ATLAS.length, "no acervo", true) +
      stat("Abertos", abertos, abertos === ATLAS.length ? "todos vistos" : (ATLAS.length - abertos) + " ainda por abrir", abertos > 0) +
      stat("Matérias", areas.length, "com pelo menos um atlas", false) + "</div>";
    if (areas.length > 1) {
      html += '<nav class="chips chips-wrap chips-rolar" aria-label="Filtrar por matéria" style="margin-bottom:var(--s5)">' +
        '<a class="chip" href="#/atlas"' + (!sel ? ' aria-current="true"' : "") + ">Todas <span class=\"chip-n num\">" + ATLAS.length + "</span></a>" +
        areas.map(function (a) {
          return '<a class="chip" href="#/atlas?area=' + a.slug + '"' + (sel === a.slug ? ' aria-current="true"' : "") + ">" + esc(a.nome) +
            ' <span class="chip-n num">' + atlasDaArea(a).length + "</span></a>";
        }).join("") + "</nav>";
    }
    if (!sel) {
      /* sem filtro: uma grade só, na ordem de leitura (matéria por peso) */
      return html + '<div class="atlas-grid">' + ATLAS.map(function (au) { return cartaoAtlas(au); }).join("") + "</div>";
    }
    var a = porArea[sel];
    return html + '<section class="bloco"><div class="section-head"><h2 class="h-sec"><a href="#/materia/' + a.slug + '">' + esc(a.nome) + "</a></h2>" +
      '<a class="link-sec" href="#/materia/' + a.slug + '">ver a matéria ' + icone("seta", 14) + "</a></div>" +
      '<div class="atlas-grid">' + atlasDaArea(a).map(function (au) { return cartaoAtlas(au); }).join("") + "</div></section>";
  }

  /* ── aula ────────────────────────────────────────────────────────────── */
  function telaAula(id) {
    secaoAtual = "materias";
    var au = aulaPorId[id];
    if (!au) return vazio("Aula não encontrada.");
    var t = porTema[au.temaId], a = porArea[au.areaSlug] || (t && porArea[t.areaSlug]) || { nome: "", slug: "" };
    document.title = au.titulo + " — Residência Max";
    P.aulas[au.id] = Date.now(); marcarDia(); salvar();
    lembrar("#/aula/" + au.id, au.titulo, rotuloFormato(au) + (a.nome ? " · " + a.nome : ""));

    var trilha = t ? trilhaTema(t) : [{ r: "Matérias", h: "#/materias" }, { r: a.nome, h: "#/materia/" + a.slug }];
    trilha.push({ r: au.titulo });

    var idx = ORDEM_AULAS.indexOf(au);
    var ant = ORDEM_AULAS[idx - 1], prox = ORDEM_AULAS[idx + 1];
    function ladoAula(x) {
      if (!x) return null;
      var tx = porTema[x.temaId];
      return { h: "#/aula/" + x.id, k: (ehAtlas(x) ? "atlas · " : "") + (tx ? tx.nome : ""), t: x.titulo };
    }
    var pager = paginador(ladoAula(ant), ladoAula(prox), "Aula anterior e próxima");
    var depois = '<div class="acoes">' +
      (t ? '<a class="btn" href="#/tema/' + esc(t.id) + '">' + icone("voltar", 15) + "Voltar ao tema</a>" : "") +
      (t && t.questoes.length ? '<a class="btn btn-primary" href="#/pratica?tema=' + esc(t.id) + '">Praticar este tema</a>' : "") +
      (t && t.cards.length ? '<a class="btn" href="#/cartoes?tema=' + esc(t.id) + '">Revisar os cartões</a>' : "") +
      "</div>";

    if (ehAtlas(au)) {
      return migalhas(trilha) +
        '<article class="atlas-view">' +
        '<header class="atlas-cab"><div>' +
        '<span class="kicker kicker-gold">' + icone("atlas", 12) + " " + esc(rotuloFormato(au)) + (a.nome ? " · " + esc(a.nome) : "") + "</span>" +
        '<h1 class="h-pagina h-atlas">' + esc(au.titulo) + "</h1>" +
        (au.origem ? '<p class="meta italic">' + esc(au.origem) + "</p>" : "") +
        (au.autor ? '<p class="meta italic">' + esc(au.autor) + "</p>" : "") +
        "</div>" +
        (t ? '<a class="btn btn-sm so-largo" href="#/tema/' + esc(t.id) + '">' + icone("voltar", 15) + "Voltar ao tema</a>" : "") +
        "</header>" +
        (au.secoes && au.secoes.length ?
          '<details class="secoes-box"><summary><span class="kicker">Neste atlas</span> <span class="meta">' + plural(au.secoes.length, "seção", "seções") + "</span></summary>" +
          '<ol class="secoes">' + au.secoes.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol></details>" : "") +
        (au.src
          ? '<div class="embed" id="embed">' +
          '<div class="embed-bar">' +
          '<span class="embed-t">' + icone("atlas", 14) + "<span>" + esc(au.titulo) + "</span></span>" +
          '<span class="embed-acoes">' +
          '<button class="btn btn-sm btn-primary" id="tela-cheia" aria-pressed="false">' + icone("expandir", 15) + '<span class="rot-cheia">Tela cheia</span></button>' +
          '<a class="btn btn-sm" href="' + esc(au.src) + '" target="_blank" rel="noopener">' + icone("externo", 15) + '<span class="so-largo">Nova aba</span><span class="sr"> (abre em nova aba)</span></a>' +
          "</span></div>" +
          '<iframe src="' + esc(au.src) + '" title="' + esc(au.titulo) + '" loading="lazy" allow="fullscreen" allowfullscreen ' +
          'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals"></iframe></div>'
          : '<div class="vazio-bloco"><p class="prose">O arquivo deste atlas não acompanha esta cópia da plataforma.</p></div>') +
        '<p class="meta italic dica-atlas">Dica: em tela cheia, <kbd class="kbd">Esc</kbd> volta para a plataforma.</p>' +
        depois + pager + "</article>";
    }

    var corpo = (au.blocos || []).map(function (b) {
      if (b.tipo === "caixa")
        return '<div class="caixa" data-e="' + esc(b.estilo) + '">' +
          (b.rotulo ? '<span class="rot">' + esc(b.rotulo) + "</span>" : "") +
          '<div class="txt">' + b.html + "</div></div>";
      if (b.tipo === "tabela")
        return '<div class="tbl-wrap" tabindex="0" role="region" aria-label="Tabela"><table><thead><tr>' +
          b.cabecalho.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
          "</tr></thead><tbody>" + b.linhas.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>";
      if (b.tipo === "subtitulo") return "<h2 class=\"sub\">" + b.html + "</h2>";
      return "<p>" + b.html + "</p>";
    }).join("");

    return migalhas(trilha) +
      '<article class="reader">' +
      '<span class="kicker">' + esc(a.nome) + " · " + esc(rotuloFormato(au)) + "</span>" +
      '<h1 class="display h-aula">' + esc(au.titulo) + "</h1>" +
      (au.origem ? '<p class="meta italic">' + esc(au.origem) + "</p>" : "") +
      (au.autor ? '<p class="meta italic">' + esc(au.autor) + "</p>" : "") +
      (au.parteDe ? '<p class="meta italic">Parte de: ' + esc(au.parteDe) + "</p>" : "") +
      '<hr class="hairline">' + corpo +
      '<hr class="hairline">' + depois + pager + "</article>";
  }

  /* ── prática ─────────────────────────────────────────────────────────── */
  var S = null; /* sessão corrente */
  function iniciarSessao(par) {
    var lista;
    if (par.q) lista = [par.q];
    else if (par.tema) lista = (porTema[par.tema] || { questoes: [] }).questoes.slice();
    else if (par.area) {
      lista = [];
      (porArea[par.area] || { temas: [] }).temas.forEach(function (id) {
        if (porTema[id]) lista = lista.concat(porTema[id].questoes);
      });
    } else if (par.colecao) {
      lista = D.questoes.filter(function (q) { return q.colecao === par.colecao; }).map(function (q) { return q.id; });
    } else if (par.modo === "erradas") {
      lista = D.questoes.filter(function (q) { return P.questoes[q.id] && !P.questoes[q.id].ok; }).map(function (q) { return q.id; });
    } else if (par.modo === "novas") {
      lista = D.questoes.filter(function (q) { return !P.questoes[q.id]; }).map(function (q) { return q.id; });
    } else {
      lista = D.questoes.map(function (q) { return q.id; });
    }
    lista = lista.filter(function (id) { return qPorId[id]; });
    if (par.embaralhar) lista = embaralhar(lista);
    var rotulo = "Banco completo";
    if (par.tema && porTema[par.tema]) rotulo = porTema[par.tema].nome;
    else if (par.area && porArea[par.area]) rotulo = porArea[par.area].nome;
    else if (par.colecao) rotulo = par.colecao;
    else if (par.q) rotulo = "Questão avulsa";
    else if (par.modo === "erradas") rotulo = "Só as que errei";
    else if (par.modo === "novas") rotulo = "Campo cego";
    S = { lista: lista, i: 0, sel: null, revelado: false, acertos: 0, erros: 0, rotulo: rotulo };
  }

  function confirmarResposta() {
    var q = qPorId[S.lista[S.i]];
    S.revelado = true;
    if (S.sel === q.correta) S.acertos++; else S.erros++;
    registrarQuestao(q.id, S.sel, q.correta);
    render(false, "#revelacao");
  }
  function avancarQuestao(i) {
    S.i = i; S.sel = null; S.revelado = false; render(false, "#enunciado", true);
  }

  function telaPratica(par) {
    secaoAtual = "pratica";
    document.title = "Prática — Residência Max";
    var assinatura = JSON.stringify(par);
    if (!S || S.assinatura !== assinatura) { iniciarSessao(par); if (S) S.assinatura = assinatura; }
    if (!S.lista.length) return telaConfigPratica("Nenhuma questão corresponde a esse recorte. Escolha outro conjunto — nada de devolver questão aleatória.");
    if (S.i >= S.lista.length) return telaFimSessao();

    var q = qPorId[S.lista[S.i]];
    var t = porTema[q.temaId], a = porArea[q.areaSlug] || {};
    lembrar("#/pratica?q=" + encodeURIComponent(q.id), "Questão " + q.n + " — " + rotuloQuestao(q),
      q.colecao || "Questões comentadas");

    var opcoes = q.alternativas.map(function (o, n) {
      var st = "";
      if (S.revelado) st = o.k === q.correta ? "certa" : (o.k === S.sel ? "errada" : "");
      else if (o.k === S.sel) st = "pick";
      var marca = S.revelado ? (o.k === q.correta ? icone("check", 18) + '<span class="sr">correta</span>' : (o.k === S.sel ? icone("x", 18) + '<span class="sr">sua resposta</span>' : "")) : "";
      return '<button class="opt" data-op="' + o.k + '"' + (S.revelado ? " disabled" : "") + (st ? ' data-st="' + st + '"' : "") +
        ' aria-pressed="' + (o.k === S.sel) + '" aria-keyshortcuts="' + (n + 1) + '">' +
        '<span class="k">' + o.k + "</span><span>" + esc(o.texto) + '</span><span class="mark">' + marca + "</span></button>";
    }).join("");

    var revelacao = "";
    if (S.revelado) {
      var certo = S.sel === q.correta;
      revelacao = '<div id="revelacao" tabindex="-1"><hr class="hairline">' +
        '<h2 class="resultado' + (certo ? " gold" : "") + '" role="status">' +
        (certo ? "Correto." : "Vamos rever.") + ' <span class="meta num">Gabarito: ' + q.correta + "</span></h2>" +
        campo("O gatilho da questão", q.gatilho) +
        campo("Comentário", q.comentario) +
        campo("Por que as demais erram", q.distratores) +
        campo("A fisiologia por trás", q.fisio) +
        campo("Pérola", q.perola) +
        campo("O que foi alterado em relação à questão-fonte", q.alterado) +
        campo("Lacuna testada", q.lacuna, true) +
        campo("Questão-fonte", q.fonte, true) +
        campo("Bibliografia identificada", q.bibliografia, true) +
        '<div class="srs">' +
        [["Errei", "10 min", 0], ["Difícil", "1 dia", 1], ["Bom", "4 dias", 2], ["Fácil", "9 dias", 3]].map(function (r) {
          return '<button class="btn" data-srs="' + r[2] + '">' + r[0] + "<small>" + r[1] + "</small></button>";
        }).join("") + "</div>" +
        '<p class="meta italic atalhos"><kbd class="kbd">→</kbd> próxima questão</p></div>';
    } else {
      revelacao = '<p class="meta italic" style="margin-top:var(--s4)">Formule a resposta mentalmente antes de marcar — a banca constrói o distrator sobre a conduta plausível porém prematura.</p>' +
        '<button class="btn btn-primary" id="confirmar"' + (S.sel ? "" : " disabled") + ">Confirmar resposta</button>" +
        '<p class="meta italic atalhos so-largo"><kbd class="kbd">1</kbd>–<kbd class="kbd">5</kbd> marcam a alternativa · <kbd class="kbd">Enter</kbd> confirma</p>';
    }

    var media = (S.acertos + S.erros) ? Math.round(S.acertos * 100 / (S.acertos + S.erros)) : 0;
    var trilha = [{ r: "Prática", h: "#/pratica" }];
    if (t) trilha.push({ r: a.nome || "", h: "#/materia/" + (a.slug || "") }, { r: t.nome, h: "#/tema/" + t.id });
    trilha.push({ r: "Questão " + (S.i + 1) + " de " + S.lista.length });

    return migalhas(trilha) +
      '<div class="pratica">' +
      "<div>" +
      '<div class="pratica-topo">' +
      '<span class="kicker">' + esc(q.colecao || "Questões comentadas") +
      (S.lista.length > 1 ? " · " + esc(S.rotulo) : "") + "</span>" +
      '<span class="meta num">Questão ' + (S.i + 1) + " de " + S.lista.length + "</span></div>" +
      '<div class="bar bar-sessao" aria-hidden="true"><i style="width:' + Math.round((S.i + (S.revelado ? 1 : 0)) * 100 / S.lista.length) + '%"></i></div>' +
      '<div style="margin-top:var(--s4)">' +
      (t ? '<a class="kicker kicker-gold" href="#/tema/' + esc(q.temaId) + '">' + esc(rotuloQuestao(q)) + " · " + esc(t.nome) + "</a>"
        : '<span class="kicker kicker-gold">' + esc(rotuloQuestao(q)) + "</span>") +
      (q.subtema ? '<span class="meta italic" style="display:block;margin-top:2px">' + esc(q.subtema) + "</span>" : "") +
      "</div>" +
      '<p class="prose enunciado" id="enunciado" tabindex="-1">' + esc(q.enunciado) + "</p>" +
      '<div role="group" aria-label="Alternativas">' + opcoes + "</div>" + revelacao +
      "</div>" +

      '<aside class="rail" aria-label="Sessão">' +
      '<div class="tally"><div><span class="kicker">Acertos</span><b class="num gold">' + S.acertos + "</b></div>" +
      '<div><span class="kicker">Erros</span><b class="num">' + S.erros + "</b></div>" +
      '<div><span class="kicker">Média</span><b class="num">' + media + "%</b></div></div>" +
      '<div><span class="kicker">Mapa da sessão</span><div class="qmap" style="margin-top:var(--s2)">' +
      S.lista.map(function (id, i) {
        var r = P.questoes[id], s = i === S.i ? "now" : r ? (r.ok ? "ok" : "x") : "";
        var est = s === "now" ? "atual" : s === "ok" ? "acertada" : s === "x" ? "errada" : "não respondida";
        return '<button data-q="' + i + '"' + (s ? ' data-s="' + s + '"' : "") + (i === S.i ? ' aria-current="step"' : "") +
          ' aria-label="Questão ' + (i + 1) + ", " + est + '">' + (i + 1) + "</button>";
      }).join("") + "</div></div>" +
      '<div><label class="kicker" for="nota">Nota de recall</label>' +
      '<textarea id="nota" placeholder="O que você quer lembrar deste item?">' + esc(P.notas[q.temaId] || "") + "</textarea>" +
      '<span class="meta italic">Salva no caderno do tema ' + esc(t ? t.nome : "") + ", neste navegador.</span></div>" +
      '<a class="btn btn-sm" href="#/pratica">Trocar de sessão</a>' +
      "</aside></div>";
  }

  function campo(rotulo, valor, discreto) {
    if (!valor) return "";
    return '<div style="margin-top:var(--s4)"><span class="kicker">' + esc(rotulo) + "</span>" +
      '<p class="prose' + (discreto ? " discreto" : "") + '" style="max-width:66ch;margin-top:2px">' +
      esc(valor) + "</p></div>";
  }

  function telaFimSessao() {
    var n = S.acertos + S.erros, pct = n ? Math.round(S.acertos * 100 / n) : 0;
    return '<h1 class="display">Sessão encerrada.</h1>' +
      '<p class="prose" style="margin-top:var(--s4)">Você respondeu ' + plural(n, "questão", "questões") +
      " nesta sessão, com " + S.acertos + " acertos.</p>" +
      '<div class="statstrip" style="margin:var(--s5) 0">' +
      stat("Acertos", S.acertos, "nesta sessão", true) +
      stat("Erros", S.erros, "vão para a fila de revisão", false) +
      stat("Aproveitamento", pct + "%", "na sessão", pct >= 70) +
      stat("Banco", TOTAL.questoes, "questões no total", false) + "</div>" +
      '<div class="acoes">' +
      '<a class="btn btn-primary" href="#/pratica?modo=erradas">Refazer o que errei</a>' +
      '<a class="btn" href="#/pratica">Nova sessão</a>' +
      '<a class="btn" href="#/">Voltar ao painel</a></div>';
  }

  function telaConfigPratica(aviso) {
    secaoAtual = "pratica";
    document.title = "Prática — Residência Max";
    var erradas = D.questoes.filter(function (q) { return P.questoes[q.id] && !P.questoes[q.id].ok; }).length;
    var novas = D.questoes.filter(function (q) { return !P.questoes[q.id]; }).length;
    return '<span class="kicker">Prática</span><h1 class="display" style="margin-top:4px">Como você quer estudar?</h1>' +
      (aviso ? '<p class="prose aviso" role="status">' + esc(aviso) + "</p>" : "") +
      '<p class="prose" style="margin-top:var(--s4)">As ' + TOTAL.questoes + " questões vêm das suas coleções, e cada uma abre o comentário completo do arquivo de origem: " +
      "o gatilho da vinheta, a análise dos distratores, a fisiologia por trás, a pérola, a questão-fonte, a bibliografia identificada e a lacuna testada — conforme o que a fonte traz.</p>" +
      '<div class="grid-cards" style="margin-top:var(--s5)">' +
      [
        { h: "#/pratica?modo=novas&embaralhar=1", t: "Campo cego", m: novas + " questões ainda não vistas", d: "Sorteio entre todos os temas, sem saber de qual matéria a questão veio." },
        { h: "#/pratica?modo=erradas", t: "Só as que errei", m: erradas + " questões", d: "A fila mais rentável: refazer o erro até ele virar conceito." },
        { h: "#/pratica?modo=todas", t: "Prova completa", m: TOTAL.questoes + " questões", d: "Na ordem do caderno original, 4 horas em condições de prova." }
      ].map(function (o) {
        return '<a class="card card-link" href="' + o.h + '">' +
          '<span class="kicker kicker-gold">' + esc(o.m) + "</span>" +
          '<span class="card-t">' + esc(o.t) + "</span>" +
          '<span class="card-d">' + esc(o.d) + "</span></a>";
      }).join("") + "</div>" +
      '<h2 class="h-sec" style="margin:var(--s6) 0 var(--s3)">Por coleção</h2>' +
      '<div class="chips chips-wrap" style="margin-bottom:var(--s5)">' + colecoes().map(function (c) {
        return '<a class="chip" href="#/pratica?colecao=' + encodeURIComponent(c.nome) + '">' +
          esc(c.nome) + ' <span class="chip-n num">' + c.n + "</span></a>";
      }).join("") + "</div>" +
      '<h2 class="h-sec" style="margin:var(--s6) 0 var(--s3)">Por matéria</h2>' +
      '<div class="chips chips-wrap">' + D.areas.filter(function (a) { return a.nQuestoes; }).map(function (a) {
        return '<a class="chip" href="#/pratica?area=' + a.slug + '">' + esc(a.nome) + ' <span class="chip-n num">' + a.nQuestoes + "</span></a>";
      }).join("") + "</div>";
  }

  function colecoes() {
    var m = {};
    D.questoes.forEach(function (q) { if (q.colecao) m[q.colecao] = (m[q.colecao] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { nome: k, n: m[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
  }

  /* ── cartões ─────────────────────────────────────────────────────────── */
  var FC = null;
  function telaCartoes(par) {
    secaoAtual = "cartoes";
    document.title = "Cartões — Residência Max";
    var assinatura = JSON.stringify(par);
    if (!FC || FC.assinatura !== assinatura) {
      var lista, rotulo = "Fila de revisão";
      if (par.tema) {
        lista = (porTema[par.tema] || { cards: [] }).cards.slice();
        if (porTema[par.tema]) rotulo = porTema[par.tema].nome;
      } else if (par.area) {
        lista = [];
        (porArea[par.area] || { temas: [] }).temas.forEach(function (id) { if (porTema[id]) lista = lista.concat(porTema[id].cards); });
        if (porArea[par.area]) rotulo = porArea[par.area].nome;
      } else lista = cardsDevidos().map(function (c) { return c.id; });
      lista = lista.filter(function (id) { return cardPorId[id]; });
      FC = { assinatura: assinatura, lista: lista, i: 0, virado: false, vistos: 0, rotulo: rotulo };
    }
    if (!FC.lista.length) return telaCartoesVazio();
    if (FC.i >= FC.lista.length) {
      return '<h1 class="display">Fila zerada.</h1><p class="prose" style="margin-top:var(--s4)">Você revisou ' +
        plural(FC.vistos, "cartão", "cartões") + '. Os que você errou voltam para a caixa 1 e vencem em um dia.</p>' +
        '<div class="acoes" style="margin-top:var(--s5)">' +
        '<a class="btn btn-primary" href="#/cartoes">Ver a fila novamente</a>' +
        '<a class="btn" href="#/">Voltar ao painel</a></div>';
    }
    var c = cardPorId[FC.lista[FC.i]];
    var t = porTema[c.temaId], a = porArea[c.areaSlug] || {}, e = estadoCard(c.id);
    var trilha = [{ r: "Cartões", h: "#/cartoes" }];
    if (par.tema && t) trilha = trilhaTema(t).concat([{ r: "Cartões" }]);
    else if (par.area && porArea[par.area]) trilha = [{ r: "Matérias", h: "#/materias" }, { r: porArea[par.area].nome, h: "#/materia/" + par.area }, { r: "Cartões" }];
    else trilha.push({ r: FC.rotulo });
    return migalhas(trilha) +
      '<div class="fc-wrap">' +
      '<div class="pratica-topo">' +
      '<span class="kicker">Repetição espaçada · ' + esc(FC.rotulo) + "</span>" +
      '<span class="meta num">' + (FC.i + 1) + " de " + FC.lista.length + " · caixa " + (e.caixa || 1) + "</span></div>" +
      '<div class="bar bar-sessao" aria-hidden="true"><i style="width:' + Math.round(FC.i * 100 / FC.lista.length) + '%"></i></div>' +
      '<div class="fc" id="fc" role="button" tabindex="0" aria-expanded="' + FC.virado + '" aria-label="' + (FC.virado ? "Cartão virado" : "Virar o cartão") + '">' +
      '<div class="fc-frente">' + esc(c.frente) + "</div>" +
      (FC.virado ? '<div class="fc-verso" aria-live="polite">' + esc(c.verso) + "</div>"
        : '<p class="meta italic" style="text-align:center">Toque para virar <span class="so-largo">· <kbd class="kbd">Espaço</kbd></span></p>') + "</div>" +
      '<p class="meta italic" style="margin-top:var(--s2)">' + esc(a.nome || "") + " · " +
      (t ? '<a href="#/tema/' + esc(c.temaId) + '">' + esc(t.nome) + "</a>" : "") +
      " · deck " + esc(c.deck) + "</p>" +
      (FC.virado ? '<div class="srs srs-2">' +
        '<button class="btn" data-fc="0" aria-keyshortcuts="1">Errei<small>volta à caixa 1</small></button>' +
        '<button class="btn btn-primary" data-fc="1" aria-keyshortcuts="2">Acertei<small>sobe uma caixa</small></button></div>' +
        '<p class="meta italic atalhos so-largo"><kbd class="kbd">1</kbd> errei · <kbd class="kbd">2</kbd> acertei</p>'
        : "") + "</div>";
  }
  function telaCartoesVazio() {
    return '<h1 class="display">Nada vencido agora.</h1>' +
      '<p class="prose" style="margin-top:var(--s4)">Os ' + TOTAL.cards + " cartões do seu deck usam cinco caixas de Leitner (1, 3, 7, 16 e 35 dias). " +
      "Nenhum venceu ainda — você pode revisar por matéria mesmo assim.</p>" +
      '<div class="chips chips-wrap" style="margin-top:var(--s5)">' +
      D.areas.filter(function (a) { return a.nCards; }).map(function (a) {
        return '<a class="chip" href="#/cartoes?area=' + a.slug + '">' + esc(a.nome) + ' <span class="chip-n num">' + a.nCards + "</span></a>";
      }).join("") + "</div>";
  }

  /* ── busca ───────────────────────────────────────────────────────────── */
  var INDICE = null;
  var TIPOS_BUSCA = [
    { k: "tudo", r: "Tudo" }, { k: "materia", r: "Matérias" }, { k: "tema", r: "Temas" },
    { k: "atlas", r: "Atlas" }, { k: "aula", r: "Aulas" }, { k: "questao", r: "Questões" }, { k: "cartao", r: "Cartões" }
  ];
  function indice() {
    if (INDICE) return INDICE;
    INDICE = [];
    D.areas.forEach(function (a) {
      INDICE.push({ tipo: "materia", t: a.nome, s: "Matéria · " + a.subtitulo, h: "#/materia/" + a.slug, k: norm(a.nome + " " + a.subtitulo) });
    });
    D.temas.forEach(function (t) {
      INDICE.push({ tipo: "tema", t: t.nome, s: "Tema · " + (porArea[t.areaSlug] || {}).nome, h: "#/tema/" + t.id, k: norm(t.nome) });
    });
    ORDEM_AULAS.forEach(function (a) {
      var txt = (a.blocos || []).map(function (b) { return b.html || (b.linhas || []).join(" "); }).join(" ");
      var nomeArea = (porArea[a.areaSlug] || {}).nome || "";
      INDICE.push({
        tipo: ehAtlas(a) ? "atlas" : "aula", t: a.titulo, s: rotuloFormato(a) + (nomeArea ? " · " + nomeArea : ""), h: "#/aula/" + a.id,
        k: norm(a.titulo + " " + (a.secoes || []).join(" ") + " " + (a.origem || "") + " " + txt.replace(/<[^>]+>/g, " ")),
        trecho: ehAtlas(a) && a.secoes ? a.secoes.join(" · ") : ""
      });
    });
    D.cards.forEach(function (c) {
      INDICE.push({ tipo: "cartao", t: c.frente, s: "Cartão · " + (porArea[c.areaSlug] || {}).nome, h: "#/tema/" + c.temaId + "?ver=cartoes", k: norm(c.frente + " " + c.verso), trecho: c.verso });
    });
    D.questoes.forEach(function (q) {
      INDICE.push({
        tipo: "questao",
        t: "Questão " + q.n + " — " + rotuloQuestao(q), s: q.colecao || "Questão comentada",
        h: "#/pratica?q=" + encodeURIComponent(q.id),
        k: norm([q.enunciado, q.comentario, q.lacuna, q.bibliografia, q.gatilho, q.perola, q.fisio].join(" ")),
        trecho: q.lacuna || q.perola || q.gatilho || q.enunciado
      });
    });
    return INDICE;
  }
  var termo = "", tipoBusca = "tudo";
  function telaBusca(par) {
    secaoAtual = "busca";
    document.title = "Buscar — Residência Max";
    if (par && typeof par.q === "string") termo = par.q;
    return '<span class="kicker">Buscar em todo o acervo</span>' +
      '<div class="search-field" role="search" style="margin:var(--s3) 0 var(--s4)">' + icone("busca", 22) +
      '<label class="sr" for="q">Buscar</label>' +
      '<input id="q" type="search" placeholder="tríade, Hinchey, conduta, Tokyo…" value="' + esc(termo) + '" autocomplete="off" enterkeyhint="search">' +
      '<kbd class="kbd so-largo" aria-hidden="true">/</kbd></div>' +
      '<div id="resultados" aria-live="polite">' + resultadosBusca() + "</div>";
  }
  function resultadosBusca() {
    var q = norm(termo.trim());
    if (q.length < 2) {
      return '<p class="prose">Procura ao mesmo tempo em ' + TOTAL.areas + " matérias, " + TOTAL.temas + " temas, " +
        TOTAL.aulas + " aulas (" + plural(ATLAS.length, "atlas", "atlas") + "), " + TOTAL.cards + " cartões e " + TOTAL.questoes + " questões comentadas.</p>" +
        '<p class="meta italic">Atalho: <kbd class="kbd">/</kbd> abre a busca de qualquer tela; <kbd class="kbd">Esc</kbd> volta.</p>';
    }
    var todos = indice().filter(function (it) { return it.k.indexOf(q) !== -1; });
    var n = {}; todos.forEach(function (it) { n[it.tipo] = (n[it.tipo] || 0) + 1; });
    var res = tipoBusca === "tudo" ? todos : todos.filter(function (it) { return it.tipo === tipoBusca; });
    var LIM = 60, total = res.length;
    res = res.slice(0, LIM);
    var chips = '<div class="chips" role="group" aria-label="Filtrar resultados" style="margin-bottom:var(--s3)">' +
      TIPOS_BUSCA.filter(function (x) { return x.k === "tudo" || n[x.k]; }).map(function (x) {
        return '<button class="chip" data-tipo-busca="' + x.k + '" aria-pressed="' + (tipoBusca === x.k) + '">' + x.r +
          ' <span class="chip-n num">' + (x.k === "tudo" ? todos.length : n[x.k]) + "</span></button>";
      }).join("") + "</div>";
    if (!todos.length) {
      return '<p class="prose">Nada encontrado para “' + esc(termo) + "”. O acervo tem só o que você produziu — se o tema não está aqui, ainda não foi escrito.</p>";
    }
    return chips + '<p class="meta" style="margin-bottom:var(--s3)">' + plural(total, "resultado", "resultados") + (total > LIM ? " (mostrando os " + LIM + " primeiros)" : "") + "</p>" +
      res.map(function (it) {
        return '<a class="hit" href="' + esc(it.h) + '">' +
          '<span class="kicker kicker-gold">' + (it.tipo === "atlas" ? icone("atlas", 12) + " " : "") + esc(it.s) + "</span>" +
          '<span class="hit-t">' + realce(it.t, termo) + "</span>" +
          (it.trecho ? '<span class="meta" style="display:block">' + realce(it.trecho.slice(0, 190), termo) + "</span>" : "") +
          "</a>";
      }).join("");
  }
  function realce(txt, t) {
    var e = esc(txt), n = norm(txt), a = norm(t.trim());
    if (!a) return e;
    var i = n.indexOf(a);
    if (i === -1) return e;
    return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + a.length)) + "</mark>" + esc(txt.slice(i + a.length));
  }
  function atualizarBusca() {
    var r = document.getElementById("resultados");
    if (r) r.innerHTML = resultadosBusca();
    /* o termo vai para o endereço sem gerar entrada no histórico */
    try { history.replaceState(null, "", "#/busca" + (termo ? "?q=" + encodeURIComponent(termo) : "")); } catch (e) { }
  }

  /* ── acervo ──────────────────────────────────────────────────────────── */
  function telaAcervo() {
    secaoAtual = "acervo";
    document.title = "Acervo — Residência Max";
    return '<span class="kicker">Procedência do material</span>' +
      '<h1 class="display" style="margin-top:4px">O acervo</h1>' +
      '<p class="prose" style="margin-top:var(--s4)">Tudo nesta plataforma foi extraído do material que você já produziu: o ebook, as apresentações e reuniões científicas, ' +
      "as aulas-atlas interativas em HTML, os simulados e o deck de repetição espaçada. Nada foi reescrito, resumido, " +
      "corrigido ou completado na importação — enunciados, comentários, cartões e slides entram literalmente como estão nos arquivos de origem. " +
      "A organização em matérias e temas é o único acréscimo, e ela é apenas um índice: quando o assunto do enunciado diverge do rótulo do arquivo, " +
      "vale o enunciado, e o rótulo original continua visível na questão.</p>" +
      '<div class="statstrip" style="margin:var(--s6) 0">' +
      stat("Matérias", TOTAL.areas, "ordenadas pelo peso na prova", false) +
      stat("Temas", TOTAL.temas, "cada um com o material vinculado", false) +
      stat("Itens de conteúdo", TOTAL.aulas + TOTAL.questoes + TOTAL.cards, "aulas, questões e cartões", true) +
      stat("Em quarentena", D.quarentena.length, D.quarentena.length ? "itens que não puderam ser lidos" : "nenhuma perda na importação", false) +
      "</div>" +
      '<h2 class="h-sec" style="margin-bottom:var(--s3)">Fontes importadas</h2>' +
      D.fontes.map(function (f) {
        return '<div class="fonte-linha">' +
          '<span><span class="peso-nome">' + esc(f.titulo) + "</span>" +
          '<span class="meta italic">' + esc(f.tipo) + "</span></span>" +
          '<b class="num peso-n gold">' + f.itens + "</b></div>";
      }).join("") +
      (D.quarentena.length
        ? '<h2 class="h-sec" style="margin:var(--s6) 0 var(--s3)">Quarentena</h2>' +
        D.quarentena.map(function (q) {
          return '<p class="meta" style="border-bottom:1px solid var(--rule);padding:var(--s2) 0">' +
            esc(q.motivo) + ' <span class="italic">(' + esc(q.origem) + ")</span></p>";
        }).join("")
        : "") +
      '<h2 class="h-sec" style="margin:var(--s6) 0 var(--s3)">Seu progresso neste navegador</h2>' +
      '<p class="prose">O progresso (aulas lidas, respostas, caixas dos cartões e notas de recall) fica no armazenamento local deste navegador. ' +
      "Ele não sai daqui e não é sincronizado entre aparelhos.</p>" +
      '<button class="btn btn-sm" id="zerar" style="margin-top:var(--s3)">Apagar meu progresso</button>';
  }

  function vazio(msg) {
    document.title = msg + " — Residência Max";
    return '<div class="vazio-bloco"><h1 class="display">' + esc(msg) + "</h1>" +
      '<p class="prose" style="margin-top:var(--s3)">O endereço pode ter mudado depois de uma atualização do acervo.</p>' +
      '<div class="acoes" style="margin-top:var(--s4)"><a class="btn btn-primary" href="#/">Ir ao painel</a>' +
      '<a class="btn" href="#/busca">Buscar</a></div></div>';
  }

  /* ── roteador ────────────────────────────────────────────────────────── */
  function parseHash() {
    /* hash que não é rota (ex.: #tela, do "pular para o conteúdo") vale como painel */
    var h = location.hash.indexOf("#/") === 0 ? location.hash.slice(1) : "/";
    var partes = h.split("?");
    var caminho = partes[0].split("/").filter(Boolean);
    var par = {};
    (partes[1] || "").split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("=");
      try { par[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); } catch (e) { }
    });
    return { caminho: caminho, par: par, base: partes[0] };
  }

  var baseAnterior = null, passos = 0;
  /* nav: houve troca de endereço. foco: seletor a focar depois do render.
     topo: rolar para o topo mesmo sem troca de endereço. */
  function render(nav, foco, topo) {
    var r = parseHash(), c = r.caminho, tela = document.getElementById("tela"), html;
    fecharTelaCheia();
    switch (c[0]) {
      case undefined: html = telaPainel(); break;
      case "materias": html = telaMaterias(); break;
      case "materia": html = telaMateria(c[1]); break;
      case "tema": html = telaTema(safeDecode(c[1]), r.par); break;
      case "aula": html = telaAula(safeDecode(c[1])); break;
      case "atlas": html = telaAtlas(r.par); break;
      case "pratica":
        html = Object.keys(r.par).length ? telaPratica(r.par) : (S = null, telaConfigPratica()); break;
      case "cartoes": html = telaCartoes(r.par); break;
      case "busca": html = telaBusca(r.par); break;
      case "acervo": html = telaAcervo(); break;
      default: html = vazio("Página não encontrada.");
    }
    tela.innerHTML = html;
    atualizarShell();
    /* trocar de aba (mesma página, outro filtro) não deve jogar a leitura para o topo */
    /* só as abas do tema (?ver=) e o filtro do atlas (?area=) preservam a rolagem */
    var mesmaPagina = r.base === baseAnterior && (c[0] === "tema" || c[0] === "atlas");
    if (nav && !mesmaPagina || topo) window.scrollTo(0, 0);
    baseAnterior = r.base;
    var q = document.getElementById("q");
    if (q && nav) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
    var alvo = foco && document.querySelector(foco);
    if (alvo) { alvo.focus({ preventScroll: !topo && foco !== "#revelacao" }); if (foco === "#revelacao") alvo.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (nav && !mesmaPagina) tela.focus({ preventScroll: true });
  }
  function safeDecode(s) { try { return decodeURIComponent(s || ""); } catch (e) { return s || ""; } }

  /* ── tela cheia do atlas ─────────────────────────────────────────────── */
  function telaCheiaAtiva() { var e = document.getElementById("embed"); return !!(e && e.classList.contains("cheio")); }
  function alternarTelaCheia() {
    var e = document.getElementById("embed");
    if (!e) return;
    if (telaCheiaAtiva()) { fecharTelaCheia(); return; }
    e.classList.add("cheio");
    document.body.classList.add("travado");
    marcarBotaoCheia(true);
    /* tenta o modo nativo; onde não existe (iPhone), fica a sobreposição */
    var fs = e.requestFullscreen || e.webkitRequestFullscreen;
    if (fs) { try { var p = fs.call(e); if (p && p.catch) p.catch(function () { }); } catch (err) { } }
  }
  function fecharTelaCheia() {
    var e = document.getElementById("embed");
    var nativo = document.fullscreenElement || document.webkitFullscreenElement;
    if (nativo) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (err) { } }
    if (e) e.classList.remove("cheio");
    document.body.classList.remove("travado");
    marcarBotaoCheia(false);
  }
  function marcarBotaoCheia(on) {
    var b = document.getElementById("tela-cheia");
    if (!b) return;
    b.setAttribute("aria-pressed", String(on));
    b.innerHTML = icone(on ? "recolher" : "expandir", 15) + '<span class="rot-cheia">' + (on ? "Sair da tela cheia" : "Tela cheia") + "</span>";
  }

  /* ── interações delegadas ────────────────────────────────────────────── */
  function ligar() {
    document.body.addEventListener("click", function (ev) {
      var el;
      if (ev.target.closest("#abrir-menu")) { abrirMenu(document.getElementById("menu-sheet").hidden); return; }
      if (ev.target.closest("[data-fechar-menu]")) { abrirMenu(false); return; }
      if (ev.target.closest("#menu-sheet a")) { abrirMenu(false); }
      if (ev.target.closest("#tela-cheia")) { alternarTelaCheia(); return; }
      if ((el = ev.target.closest("[data-filtro]"))) { filtroMateria = el.getAttribute("data-filtro"); render(); return; }
      if ((el = ev.target.closest("[data-tipo-busca]"))) {
        tipoBusca = el.getAttribute("data-tipo-busca");
        var r = document.getElementById("resultados"); if (r) r.innerHTML = resultadosBusca();
        var b = document.querySelector('[data-tipo-busca="' + tipoBusca + '"]'); if (b) b.focus();
        return;
      }
      if ((el = ev.target.closest("[data-op]")) && S && !S.revelado) {
        S.sel = el.getAttribute("data-op"); render(false, '[data-op="' + S.sel + '"]'); return;
      }
      if (ev.target.closest("#confirmar") && S && S.sel && !S.revelado) { confirmarResposta(); return; }
      if ((el = ev.target.closest("[data-srs]")) && S) { avancarQuestao(S.i + 1); return; }
      if ((el = ev.target.closest("[data-q]")) && S) { avancarQuestao(parseInt(el.getAttribute("data-q"), 10)); return; }
      if (ev.target.closest("#fc") && FC && !FC.virado && !ev.target.closest("a")) { virarCartao(); return; }
      if ((el = ev.target.closest("[data-fc]")) && FC) { avaliar(el.getAttribute("data-fc") === "1"); return; }
      if (ev.target.closest("#zerar")) {
        if (confirm("Apagar todo o progresso salvo neste navegador?")) {
          P = progressoVazio();
          try { localStorage.removeItem(CHAVE); } catch (e) { }
          render();
        }
        return;
      }
    });

    document.body.addEventListener("input", function (ev) {
      if (ev.target.id === "q") { termo = ev.target.value; atualizarBusca(); }
      if (ev.target.id === "nota" && S) {
        P.notas[qPorId[S.lista[S.i]].temaId] = ev.target.value; salvar();
      }
    });

    document.addEventListener("keydown", function (ev) {
      var tag = ev.target.tagName, digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || ev.target.isContentEditable;
      if (ev.key === "Escape") {
        if (!document.getElementById("menu-sheet").hidden) { abrirMenu(false); return; }
        if (telaCheiaAtiva()) { fecharTelaCheia(); return; }
        if (ev.target.id === "q") { if (passos > 0) history.back(); else irPara("#/"); return; }
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K")) { ev.preventDefault(); irBusca(); }
        return;
      }
      if (digitando) return;
      if (ev.key === "/") { ev.preventDefault(); irBusca(); return; }

      /* cartões: espaço/enter vira; 1 errei, 2 acertei */
      if (FC && location.hash.indexOf("#/cartoes") === 0 && document.getElementById("fc")) {
        var noCartao = ev.target.id === "fc" || ev.target.id === "tela" || ev.target === document.body;
        if (!FC.virado && noCartao && (ev.key === " " || ev.key === "Enter")) { ev.preventDefault(); virarCartao(); return; }
        if (FC.virado && (ev.key === "1" || ev.key === "2")) { avaliar(ev.key === "2"); return; }
        return;
      }

      if (!S || location.hash.indexOf("#/pratica") !== 0) return;
      var q = qPorId[S.lista[S.i]];
      if (!q) return;
      if (/^[1-5]$/.test(ev.key) && !S.revelado) {
        var o = q.alternativas[parseInt(ev.key, 10) - 1];
        if (o) { S.sel = o.k; render(false, '[data-op="' + o.k + '"]'); }
      } else if (ev.key === "Enter" && S.sel && !S.revelado && !ev.target.closest("a,button:not([data-op])")) {
        ev.preventDefault(); confirmarResposta();
      } else if (ev.key === "ArrowRight" && S.revelado) {
        avancarQuestao(S.i + 1);
      }
    });

    function sairNativo() {
      if (!(document.fullscreenElement || document.webkitFullscreenElement) && telaCheiaAtiva()) fecharTelaCheia();
    }
    document.addEventListener("fullscreenchange", sairNativo);
    document.addEventListener("webkitfullscreenchange", sairNativo);

    window.addEventListener("hashchange", function () {
      if (location.hash && location.hash.indexOf("#/") !== 0) return;
      passos++; render(true);
    });
  }
  function irBusca() {
    var q = document.getElementById("q");
    if (q) { q.focus(); q.select(); } else irPara("#/busca");
  }
  function virarCartao() { FC.virado = true; render(false, "#fc"); }
  function avaliar(acertou) {
    avaliarCard(FC.lista[FC.i], acertou);
    FC.i++; FC.vistos++; FC.virado = false; render(false, "#fc");
  }

  montarShell();
  ligar();
  render(true);
})();
