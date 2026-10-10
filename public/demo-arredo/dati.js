/* Prodotti inventati per la demo: nome, marca, categoria, prezzo, foto, foto ambientate, stato per PV. */
window.PRODOTTI = [
  { id: 1, nome: "Tavolo Rio 210 con 6 sedie Net", marca: "NARDI", cat: "Tavoli", prezzo: "€ 1.290", listino: "€ 1.540", promo: "-16%", foto: "img/p_rio.jpg", amb: ["img/em_giardino.jpg", "img/em_terrazza.jpg"], stato: "ok", descr: "Resina fiberglass. Si allunga con una mano sola." },
  { id: 2, nome: "Set Cube tortora, 6 posti", marca: "EMU", cat: "Tavoli", prezzo: "€ 1.190", novita: true, foto: "img/p_legno.jpg", amb: ["img/em_giardino.jpg"], stato: "ok", descr: "Alluminio verniciato, piano in teak." },
  { id: 3, nome: "Tavolo Rio 140 con 4 sedie", marca: "NARDI", cat: "Tavoli", prezzo: "€ 890", foto: "img/p_bistro.jpg", amb: [], stato: "pochi", descr: "Il piccolo della famiglia Rio." },
  { id: 4, nome: "Tavolo Libeccio teak 200", marca: "SCAB", cat: "Tavoli", prezzo: "€ 1.690", foto: "img/p_rattan.jpg", amb: ["img/em_terrazza.jpg"], stato: "ordina", descr: "Teak massello certificato FSC." },
  { id: 5, nome: "Divano Round 3 posti, tortora", marca: "EMU", cat: "Lounge", prezzo: "€ 1.320", listino: "€ 1.890", promo: "-30%", foto: "img/p_divano.jpg", amb: ["img/em_terrazza.jpg", "img/em_piscina.jpg"], stato: "ok", descr: "Alluminio e corda intrecciata. Cuscini sfoderabili." },
  { id: 6, nome: "Set lounge Kyoto, legno e cuscini", marca: "SCAB", cat: "Lounge", prezzo: "€ 1.490", foto: "img/p_lounge_legno.jpg", amb: ["img/em_giardino.jpg"], stato: "ok", descr: "Acacia oliata, cuscini idrorepellenti." },
  { id: 7, nome: "Set lounge Aria bianco, 5 posti", marca: "NARDI", cat: "Lounge", prezzo: "€ 2.190", novita: true, foto: "img/p_lounge_bianco.jpg", amb: ["img/em_terrazza.jpg"], stato: "ok", descr: "Struttura in alluminio, sotto la pergola o in piscina." },
  { id: 8, nome: "Set Komodo, 4 posti", marca: "NARDI", cat: "Lounge", prezzo: "€ 1.740", foto: "img/p_lounge_bianco.jpg", amb: [], stato: "pochi", descr: "Modulare: si ricompone come vuoi." },
  { id: 9, nome: "Sedia Darwin, 4 colori", marca: "EMU", cat: "Sedie", prezzo: "€ 69", foto: "img/p_sedie_filo.jpg", amb: [], stato: "ok", descr: "Acciaio verniciato, impilabile." },
  { id: 10, nome: "Poltroncina Bistrot nero", marca: "SCAB", cat: "Sedie", prezzo: "€ 89", foto: "img/p_bistro.jpg", amb: [], stato: "ok", descr: "Per il tavolino del caffè." },
  { id: 11, nome: "Lettino Alfa con ombrellone", marca: "NARDI", cat: "Ombrelloni", prezzo: "€ 349", listino: "€ 420", promo: "-17%", foto: "img/p_sdraio.jpg", amb: ["img/em_piscina.jpg"], stato: "ok", descr: "Schienale a 5 posizioni, ruote." },
  { id: 12, nome: "Ombrellone Alfa 3 m con base", marca: "NARDI", cat: "Ombrelloni", prezzo: "€ 289", foto: "img/em_giardino.jpg", amb: [], stato: "ok", descr: "Palo in alluminio, telo 180 g." },
  { id: 13, nome: "Dondolo Nido in rattan", marca: "EMU", cat: "Lounge", prezzo: "€ 590", novita: true, foto: "img/p_dondolo.jpg", amb: [], stato: "ordina", descr: "Da appendere, con cuscino." },
  { id: 14, nome: "Sedie Riviera, set di 2", marca: "SCAB", cat: "Sedie", prezzo: "€ 149", foto: "img/p_sedie_filo.jpg", amb: [], stato: "ok", descr: "Filo d'acciaio, leggere." },
];
window.CATEGORIE = ["Tutti", "Tavoli", "Sedie", "Lounge", "Ombrelloni"];
window.STATI = { ok: ["● Disponibile", "ok"], pochi: ["● Ultimi 2", "pochi"], ordina: ["○ Su ordinazione", "ordina"] };
window.tessera = function (p, grande) {
  return '<a href="scheda.html" class="' + (p.spento ? "spento" : "") + '">' +
    '<span class="foto"><img src="' + p.foto + '" alt="" loading="lazy">' + (p.promo ? '<span class="pill">' + p.promo + "</span>" : p.novita ? '<span class="pill nero">NOVITÀ</span>' : "") + "</span>" +
    '<span class="marca">' + p.marca + "</span><strong>" + p.nome + "</strong>" +
    '<span class="prezzo">' + p.prezzo + (p.listino ? ' <span class="barrato" style="font-size:.8em">' + p.listino + "</span>" : "") + "</span>" +
    '<span class="stato ' + STATI[p.stato][1] + '">' + STATI[p.stato][0] + (grande && p.stato === "ok" ? " qui" : "") + "</span></a>";
};
