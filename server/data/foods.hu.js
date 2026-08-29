/**
 * FitTrack Pro — étel-adatbázis (magyar)
 * ======================================
 * Ez a fájl az étel-katalógus EGYETLEN szerkesztési helye. Az importáló
 * (server/import.js) innen tölti fel a `foods` és `food_portions` táblákat;
 * a felület és a naplózás már a táblákból olvas.
 *
 * Mezők
 * -----
 *   name      Magyar név. Egyben stabil azonosító: a `foods.source_id` ebből
 *             képződik, tehát átnevezés új sort hoz létre. A zárójeles
 *             pontosítás („nyers", „főtt", „konzerv") a névhez tartozik, mert
 *             a tápérték nagyban függ tőle.
 *   group     Kategória — a keresés csoportosításához és későbbi szűréshez.
 *   unit      'g' vagy 'ml'. Az italoknál 'ml': a felület ezt írja ki az
 *             adagválasztóban, mert az „500 g kóla" értelmetlen.
 *   kcal      Kalória 100 g / 100 ml alapmennyiségre.
 *   protein   Fehérje (g) / 100 alapmennyiség.
 *   carbs     Szénhidrát (g) / 100 alapmennyiség.
 *   fat       Zsír (g) / 100 alapmennyiség.
 *   portions  Reális adagok: [['1 db (M)', 55], ...]. A grammérték MINDIG
 *             grammban (ill. ml-ben) értendő, és ebből lesznek az étel-modál
 *             gyorsgombjai. Elhagyható, ha nincs értelmes adagegység.
 *
 * FONTOS — az adatok jellege
 * --------------------------
 * Ezek TÁBLÁZATOS REFERENCIAÉRTÉKEK (általános élelmiszer-összetételi
 * adatokból, kerekítve), nem konkrét márkák laborral mért címkeadatai. Egy
 * bolti termék tényleges tápértéke ettől eltérhet — étrend-tervezéshez így is
 * bőven pontos, de aki grammra pontos címkeadatot akar, az a saját terméke
 * csomagolásáról vigye fel. A készételeknél (gulyás, pörkölt, rakott
 * krumpli) a szórás különösen nagy: ezek jellemző házi receptúrára vett
 * átlagértékek.
 */

/* A kategóriák megjelenítési sorrendje. A lista a public/shared/foodgroups.js-ben
   lakik, mert a Gyűjtő (public/gyujto/) a böngészőben, szerver nélkül és
   offline is ugyanezekből a kategóriákból választ — két másolatból előbb-utóbb
   két különböző kategória-halmaz lenne. Innen újra-exportáljuk, hogy a
   hívóknak (db.js, server.js) ne kelljen tudniuk a bontásról. */
export { FOOD_GROUPS } from '../../public/shared/foodgroups.js';

/** Korábbi nevek → jelenlegi név (átnevezéskor tölteni, hogy ne duplázódjon). */
export const RENAMED_FROM = {
  // A kezdeti hét étel neve, amelyeket a bővített lista pontosított.
  'Csirkemell': 'Csirkemell (nyers)',
  'Rizs (főtt)': 'Fehér rizs (főtt)',
  'Túró (sovány)': 'Sovány túró',
};

export const foods = [
  /* ==================================================================
     Hús, baromfi
     ================================================================== */
  { name: 'Csirkemell (nyers)', group: 'Hús, baromfi', kcal: 110, protein: 23, carbs: 0, fat: 1.8, portions: [['1 filé', 150]] },
  { name: 'Csirkemell (sült)', group: 'Hús, baromfi', kcal: 165, protein: 31, carbs: 0, fat: 3.6, portions: [['1 adag', 150]] },
  { name: 'Csirkecomb (bőr nélkül)', group: 'Hús, baromfi', kcal: 120, protein: 20, carbs: 0, fat: 4.5, portions: [['1 db', 120]] },
  { name: 'Csirkecomb (bőrös)', group: 'Hús, baromfi', kcal: 185, protein: 17, carbs: 0, fat: 13, portions: [['1 db', 150]] },
  { name: 'Csirkeszárny', group: 'Hús, baromfi', kcal: 210, protein: 19, carbs: 0, fat: 15, portions: [['1 db', 35]] },
  { name: 'Csirkemáj', group: 'Hús, baromfi', kcal: 120, protein: 20, carbs: 1.5, fat: 4, portions: [['1 adag', 150]] },
  { name: 'Csirke darált hús', group: 'Hús, baromfi', kcal: 143, protein: 20, carbs: 0, fat: 7 },
  { name: 'Pulykamell (nyers)', group: 'Hús, baromfi', kcal: 105, protein: 24, carbs: 0, fat: 1, portions: [['1 filé', 150]] },
  { name: 'Pulykacomb', group: 'Hús, baromfi', kcal: 130, protein: 20, carbs: 0, fat: 5.5 },
  { name: 'Pulyka darált hús', group: 'Hús, baromfi', kcal: 150, protein: 20, carbs: 0, fat: 8 },
  { name: 'Kacsamell (bőrös)', group: 'Hús, baromfi', kcal: 200, protein: 18, carbs: 0, fat: 14, portions: [['1 db', 200]] },
  { name: 'Libamáj', group: 'Hús, baromfi', kcal: 130, protein: 16, carbs: 1, fat: 6.5 },
  { name: 'Sertéskaraj', group: 'Hús, baromfi', kcal: 143, protein: 22, carbs: 0, fat: 6, portions: [['1 szelet', 120]] },
  { name: 'Sertéstarja', group: 'Hús, baromfi', kcal: 220, protein: 18, carbs: 0, fat: 16, portions: [['1 szelet', 150]] },
  { name: 'Sertéscomb', group: 'Hús, baromfi', kcal: 160, protein: 21, carbs: 0, fat: 8 },
  { name: 'Sertésoldalas', group: 'Hús, baromfi', kcal: 290, protein: 17, carbs: 0, fat: 25, portions: [['1 adag', 250]] },
  { name: 'Szűzpecsenye', group: 'Hús, baromfi', kcal: 120, protein: 22, carbs: 0, fat: 3.5, portions: [['1 adag', 150]] },
  { name: 'Sertés darált hús', group: 'Hús, baromfi', kcal: 250, protein: 17, carbs: 0, fat: 20 },
  { name: 'Sertésmáj', group: 'Hús, baromfi', kcal: 135, protein: 21, carbs: 2.5, fat: 4.5 },
  { name: 'Marhahátszín', group: 'Hús, baromfi', kcal: 190, protein: 21, carbs: 0, fat: 12, portions: [['1 steak', 200]] },
  { name: 'Marha bélszín', group: 'Hús, baromfi', kcal: 145, protein: 22, carbs: 0, fat: 6, portions: [['1 steak', 180]] },
  { name: 'Marhalábszár', group: 'Hús, baromfi', kcal: 130, protein: 21, carbs: 0, fat: 5 },
  { name: 'Marha darált hús (15%)', group: 'Hús, baromfi', kcal: 215, protein: 18, carbs: 0, fat: 15 },
  { name: 'Marha darált hús (5%)', group: 'Hús, baromfi', kcal: 137, protein: 21, carbs: 0, fat: 5 },
  { name: 'Borjúhús', group: 'Hús, baromfi', kcal: 105, protein: 20, carbs: 0, fat: 2.5 },
  { name: 'Bárányhús', group: 'Hús, baromfi', kcal: 230, protein: 18, carbs: 0, fat: 17 },
  { name: 'Nyúlhús', group: 'Hús, baromfi', kcal: 115, protein: 21, carbs: 0, fat: 3 },
  { name: 'Vaddisznóhús', group: 'Hús, baromfi', kcal: 120, protein: 21, carbs: 0, fat: 3.5 },
  { name: 'Őzhús', group: 'Hús, baromfi', kcal: 105, protein: 22, carbs: 0, fat: 1.5 },

  /* ==================================================================
     Felvágott, húskészítmény
     ================================================================== */
  { name: 'Csirkemell sonka', group: 'Felvágott', kcal: 105, protein: 18, carbs: 2, fat: 2.5, portions: [['1 szelet', 20]] },
  { name: 'Pulykasonka', group: 'Felvágott', kcal: 100, protein: 17, carbs: 2, fat: 2.5, portions: [['1 szelet', 20]] },
  { name: 'Főtt sonka', group: 'Felvágott', kcal: 130, protein: 19, carbs: 1, fat: 5.5, portions: [['1 szelet', 20]] },
  { name: 'Parasztsonka (füstölt)', group: 'Felvágott', kcal: 200, protein: 22, carbs: 0.5, fat: 12, portions: [['1 szelet', 20]] },
  { name: 'Párizsi', group: 'Felvágott', kcal: 270, protein: 11, carbs: 3, fat: 24, portions: [['1 szelet', 20]] },
  { name: 'Virsli', group: 'Felvágott', kcal: 260, protein: 12, carbs: 2, fat: 22, portions: [['1 pár', 100]] },
  { name: 'Bécsi virsli', group: 'Felvágott', kcal: 280, protein: 11, carbs: 2, fat: 25, portions: [['1 pár', 100]] },
  { name: 'Gyulai kolbász', group: 'Felvágott', kcal: 400, protein: 17, carbs: 1, fat: 36, portions: [['1 karika', 15]] },
  { name: 'Debreceni kolbász', group: 'Felvágott', kcal: 320, protein: 15, carbs: 1, fat: 28, portions: [['1 pár', 100]] },
  { name: 'Csabai kolbász', group: 'Felvágott', kcal: 430, protein: 18, carbs: 1, fat: 40, portions: [['1 karika', 15]] },
  { name: 'Téliszalámi', group: 'Felvágott', kcal: 470, protein: 20, carbs: 1, fat: 43, portions: [['1 szelet', 8]] },
  { name: 'Bacon (angolszalonna)', group: 'Felvágott', kcal: 400, protein: 14, carbs: 0, fat: 38, portions: [['1 szelet', 12]] },
  { name: 'Császárszalonna', group: 'Felvágott', kcal: 500, protein: 12, carbs: 0, fat: 50 },
  { name: 'Mangalica szalonna', group: 'Felvágott', kcal: 700, protein: 8, carbs: 0, fat: 75 },
  { name: 'Zsírszalonna', group: 'Felvágott', kcal: 740, protein: 5, carbs: 0, fat: 80 },
  { name: 'Disznósajt', group: 'Felvágott', kcal: 260, protein: 15, carbs: 1, fat: 22, portions: [['1 szelet', 30]] },
  { name: 'Májas hurka', group: 'Felvágott', kcal: 300, protein: 12, carbs: 6, fat: 25, portions: [['1 db', 120]] },
  { name: 'Véres hurka', group: 'Felvágott', kcal: 280, protein: 11, carbs: 8, fat: 23, portions: [['1 db', 120]] },
  { name: 'Kenőmájas', group: 'Felvágott', kcal: 300, protein: 11, carbs: 3, fat: 27, portions: [['1 evőkanál', 20]] },

  /* ==================================================================
     Hal, tenger gyümölcse
     ================================================================== */
  { name: 'Lazac (nyers)', group: 'Hal, tenger gyümölcse', kcal: 208, protein: 20, carbs: 0, fat: 13, portions: [['1 filé', 150]] },
  { name: 'Lazac (füstölt)', group: 'Hal, tenger gyümölcse', kcal: 180, protein: 22, carbs: 0, fat: 10, portions: [['1 szelet', 25]] },
  { name: 'Tonhal (konzerv, vízben)', group: 'Hal, tenger gyümölcse', kcal: 110, protein: 25, carbs: 0, fat: 1, portions: [['1 konzerv', 120]] },
  { name: 'Tonhal (konzerv, olajban)', group: 'Hal, tenger gyümölcse', kcal: 190, protein: 25, carbs: 0, fat: 10, portions: [['1 konzerv', 120]] },
  { name: 'Tonhal (friss)', group: 'Hal, tenger gyümölcse', kcal: 145, protein: 24, carbs: 0, fat: 5, portions: [['1 steak', 150]] },
  { name: 'Ponty', group: 'Hal, tenger gyümölcse', kcal: 130, protein: 18, carbs: 0, fat: 6, portions: [['1 szelet', 150]] },
  { name: 'Pisztráng', group: 'Hal, tenger gyümölcse', kcal: 120, protein: 20, carbs: 0, fat: 4.5, portions: [['1 db', 200]] },
  { name: 'Harcsa', group: 'Hal, tenger gyümölcse', kcal: 105, protein: 17, carbs: 0, fat: 4 },
  { name: 'Süllő', group: 'Hal, tenger gyümölcse', kcal: 85, protein: 19, carbs: 0, fat: 0.7, portions: [['1 filé', 150]] },
  { name: 'Busa', group: 'Hal, tenger gyümölcse', kcal: 110, protein: 17, carbs: 0, fat: 4.5 },
  { name: 'Tőkehal', group: 'Hal, tenger gyümölcse', kcal: 82, protein: 18, carbs: 0, fat: 0.7, portions: [['1 filé', 150]] },
  { name: 'Tengeri keszeg (dorada)', group: 'Hal, tenger gyümölcse', kcal: 100, protein: 20, carbs: 0, fat: 2, portions: [['1 db', 250]] },
  { name: 'Szardínia (konzerv)', group: 'Hal, tenger gyümölcse', kcal: 210, protein: 25, carbs: 0, fat: 12, portions: [['1 konzerv', 90]] },
  { name: 'Makréla (füstölt)', group: 'Hal, tenger gyümölcse', kcal: 300, protein: 19, carbs: 0, fat: 25 },
  { name: 'Hering', group: 'Hal, tenger gyümölcse', kcal: 160, protein: 18, carbs: 0, fat: 9 },
  { name: 'Angolna', group: 'Hal, tenger gyümölcse', kcal: 185, protein: 18, carbs: 0, fat: 12 },
  { name: 'Garnélarák', group: 'Hal, tenger gyümölcse', kcal: 85, protein: 20, carbs: 0, fat: 0.5, portions: [['1 adag', 150]] },
  { name: 'Kalmár', group: 'Hal, tenger gyümölcse', kcal: 92, protein: 16, carbs: 3, fat: 1.4 },
  { name: 'Fekete kagyló', group: 'Hal, tenger gyümölcse', kcal: 86, protein: 12, carbs: 3.7, fat: 2.2 },
  { name: 'Rákhús', group: 'Hal, tenger gyümölcse', kcal: 85, protein: 18, carbs: 0, fat: 1 },
  { name: 'Surimi (rákrúd)', group: 'Hal, tenger gyümölcse', kcal: 100, protein: 8, carbs: 14, fat: 1, portions: [['1 rúd', 17]] },
  { name: 'Halrudacska (panírozott)', group: 'Hal, tenger gyümölcse', kcal: 200, protein: 12, carbs: 18, fat: 9, portions: [['1 db', 30]] },

  /* ==================================================================
     Tojás
     ================================================================== */
  { name: 'Tojás (nyers, egész)', group: 'Tojás', kcal: 143, protein: 13, carbs: 0.7, fat: 9.5, portions: [['1 db (M)', 55], ['1 db (L)', 65]] },
  { name: 'Főtt tojás', group: 'Tojás', kcal: 155, protein: 13, carbs: 1.1, fat: 11, portions: [['1 db', 55]] },
  { name: 'Tojásfehérje', group: 'Tojás', kcal: 52, protein: 11, carbs: 0.7, fat: 0.2, portions: [['1 db fehérje', 33]] },
  { name: 'Tojássárgája', group: 'Tojás', kcal: 320, protein: 16, carbs: 3.6, fat: 27, portions: [['1 db sárgája', 18]] },
  { name: 'Rántotta (olajjal)', group: 'Tojás', kcal: 180, protein: 12, carbs: 1, fat: 14, portions: [['2 tojásból', 130]] },
  { name: 'Fürjtojás', group: 'Tojás', kcal: 158, protein: 13, carbs: 0.4, fat: 11, portions: [['1 db', 10]] },

  /* ==================================================================
     Tejtermék
     ================================================================== */
  { name: 'Tej 1,5%', group: 'Tejtermék', unit: 'ml', kcal: 46, protein: 3.3, carbs: 4.8, fat: 1.5, portions: [['1 pohár', 250]] },
  { name: 'Tej 2,8%', group: 'Tejtermék', unit: 'ml', kcal: 60, protein: 3.3, carbs: 4.7, fat: 2.8, portions: [['1 pohár', 250]] },
  { name: 'Tej 3,5%', group: 'Tejtermék', unit: 'ml', kcal: 64, protein: 3.2, carbs: 4.7, fat: 3.5, portions: [['1 pohár', 250]] },
  { name: 'Sovány tej 0,1%', group: 'Tejtermék', unit: 'ml', kcal: 35, protein: 3.4, carbs: 4.9, fat: 0.1, portions: [['1 pohár', 250]] },
  { name: 'Laktózmentes tej 1,5%', group: 'Tejtermék', unit: 'ml', kcal: 46, protein: 3.3, carbs: 4.8, fat: 1.5, portions: [['1 pohár', 250]] },
  { name: 'Kefir 1,5%', group: 'Tejtermék', kcal: 50, protein: 3.3, carbs: 4, fat: 1.5, portions: [['1 pohár', 250]] },
  { name: 'Író', group: 'Tejtermék', unit: 'ml', kcal: 40, protein: 3.4, carbs: 4.7, fat: 0.5, portions: [['1 pohár', 250]] },
  { name: 'Natúr joghurt 3,5%', group: 'Tejtermék', kcal: 63, protein: 3.5, carbs: 4.7, fat: 3.3, portions: [['1 pohár', 150]] },
  { name: 'Natúr joghurt 1,5%', group: 'Tejtermék', kcal: 48, protein: 4.4, carbs: 5, fat: 1.5, portions: [['1 pohár', 150]] },
  { name: 'Görög joghurt 10%', group: 'Tejtermék', kcal: 130, protein: 5, carbs: 3.6, fat: 10, portions: [['1 pohár', 150]] },
  { name: 'Görög joghurt 2%', group: 'Tejtermék', kcal: 73, protein: 9, carbs: 4, fat: 2, portions: [['1 pohár', 150]] },
  { name: 'Skyr', group: 'Tejtermék', kcal: 63, protein: 11, carbs: 4, fat: 0.2, portions: [['1 pohár', 150]] },
  { name: 'Gyümölcsjoghurt', group: 'Tejtermék', kcal: 90, protein: 3.2, carbs: 14, fat: 2.5, portions: [['1 pohár', 150]] },
  { name: 'Sovány túró', group: 'Tejtermék', kcal: 98, protein: 18, carbs: 4, fat: 0.5, portions: [['1 csomag', 250]] },
  { name: 'Félzsíros túró', group: 'Tejtermék', kcal: 130, protein: 16, carbs: 3.5, fat: 6, portions: [['1 csomag', 250]] },
  { name: 'Zsíros túró', group: 'Tejtermék', kcal: 165, protein: 14, carbs: 3, fat: 11, portions: [['1 csomag', 250]] },
  { name: 'Laktózmentes túró', group: 'Tejtermék', kcal: 100, protein: 17, carbs: 4, fat: 1, portions: [['1 csomag', 250]] },
  { name: 'Cottage cheese', group: 'Tejtermék', kcal: 98, protein: 11, carbs: 3.4, fat: 4.3, portions: [['1 doboz', 200]] },
  { name: 'Túró Rudi', group: 'Tejtermék', kcal: 350, protein: 8, carbs: 38, fat: 18, portions: [['1 db', 30]] },
  { name: 'Körözött', group: 'Tejtermék', kcal: 200, protein: 12, carbs: 3, fat: 15, portions: [['1 adag', 100]] },
  { name: 'Tejföl 12%', group: 'Tejtermék', kcal: 130, protein: 2.8, carbs: 3.5, fat: 12, portions: [['1 evőkanál', 20]] },
  { name: 'Tejföl 20%', group: 'Tejtermék', kcal: 200, protein: 2.5, carbs: 3.2, fat: 20, portions: [['1 evőkanál', 20]] },
  { name: 'Habtejszín 30%', group: 'Tejtermék', unit: 'ml', kcal: 290, protein: 2.3, carbs: 3, fat: 30, portions: [['1 evőkanál', 15]] },
  { name: 'Főzőtejszín 12%', group: 'Tejtermék', unit: 'ml', kcal: 130, protein: 2.7, carbs: 4, fat: 12, portions: [['1 evőkanál', 15]] },
  { name: 'Vaj', group: 'Tejtermék', kcal: 740, protein: 0.7, carbs: 0.7, fat: 82, portions: [['1 evőkanál', 15], ['1 kockányi', 5]] },
  { name: 'Margarin', group: 'Tejtermék', kcal: 600, protein: 0.2, carbs: 0.5, fat: 66, portions: [['1 evőkanál', 15]] },
  { name: 'Trappista sajt', group: 'Tejtermék', kcal: 330, protein: 25, carbs: 1, fat: 25, portions: [['1 szelet', 25]] },
  { name: 'Edami sajt', group: 'Tejtermék', kcal: 300, protein: 26, carbs: 1, fat: 21, portions: [['1 szelet', 25]] },
  { name: 'Gouda', group: 'Tejtermék', kcal: 356, protein: 25, carbs: 2, fat: 27, portions: [['1 szelet', 25]] },
  { name: 'Cheddar', group: 'Tejtermék', kcal: 400, protein: 25, carbs: 1.3, fat: 33, portions: [['1 szelet', 25]] },
  { name: 'Füstölt sajt', group: 'Tejtermék', kcal: 320, protein: 24, carbs: 1, fat: 24, portions: [['1 szelet', 25]] },
  { name: 'Mozzarella', group: 'Tejtermék', kcal: 280, protein: 22, carbs: 2, fat: 21, portions: [['1 golyó', 125]] },
  { name: 'Parmezán', group: 'Tejtermék', kcal: 390, protein: 36, carbs: 4, fat: 25, portions: [['1 evőkanál (reszelt)', 5]] },
  { name: 'Camembert', group: 'Tejtermék', kcal: 300, protein: 20, carbs: 0.5, fat: 24, portions: [['1 doboz', 120]] },
  { name: 'Feta', group: 'Tejtermék', kcal: 265, protein: 14, carbs: 4, fat: 21, portions: [['1 adag', 50]] },
  { name: 'Kéksajt', group: 'Tejtermék', kcal: 350, protein: 21, carbs: 2, fat: 29, portions: [['1 adag', 30]] },
  { name: 'Juhtúró', group: 'Tejtermék', kcal: 240, protein: 17, carbs: 2, fat: 18 },
  { name: 'Ricotta', group: 'Tejtermék', kcal: 150, protein: 11, carbs: 3, fat: 11 },
  { name: 'Mascarpone', group: 'Tejtermék', kcal: 430, protein: 4, carbs: 4, fat: 44, portions: [['1 evőkanál', 20]] },
  { name: 'Ömlesztett sajt', group: 'Tejtermék', kcal: 280, protein: 12, carbs: 6, fat: 23, portions: [['1 háromszög', 17]] },
  { name: 'Krémsajt (natúr)', group: 'Tejtermék', kcal: 250, protein: 6, carbs: 4, fat: 23, portions: [['1 evőkanál', 20]] },
  { name: 'Tejbegríz', group: 'Tejtermék', kcal: 100, protein: 3.5, carbs: 15, fat: 2.5, portions: [['1 adag', 300]] },
  { name: 'Vaníliás puding', group: 'Tejtermék', kcal: 110, protein: 3, carbs: 17, fat: 3.5, portions: [['1 doboz', 125]] },
  { name: 'Kakaó (tejjel)', group: 'Tejtermék', unit: 'ml', kcal: 80, protein: 3.4, carbs: 11, fat: 2.5, portions: [['1 pohár', 250]] },
  { name: 'Jégkrém (vaníliás)', group: 'Tejtermék', kcal: 200, protein: 3.5, carbs: 24, fat: 10, portions: [['1 gombóc', 50]] },

  /* ==================================================================
     Gabona, pékáru
     ================================================================== */
  { name: 'Fehér kenyér', group: 'Gabona, pékáru', kcal: 265, protein: 8, carbs: 49, fat: 3, portions: [['1 szelet', 30]] },
  { name: 'Félbarna kenyér', group: 'Gabona, pékáru', kcal: 250, protein: 8, carbs: 47, fat: 3, portions: [['1 szelet', 30]] },
  { name: 'Teljes kiőrlésű kenyér', group: 'Gabona, pékáru', kcal: 240, protein: 10, carbs: 40, fat: 4, portions: [['1 szelet', 35]] },
  { name: 'Rozskenyér', group: 'Gabona, pékáru', kcal: 250, protein: 8, carbs: 45, fat: 3, portions: [['1 szelet', 35]] },
  { name: 'Magvas kenyér', group: 'Gabona, pékáru', kcal: 280, protein: 10, carbs: 38, fat: 9, portions: [['1 szelet', 40]] },
  { name: 'Toast kenyér', group: 'Gabona, pékáru', kcal: 280, protein: 8, carbs: 50, fat: 5, portions: [['1 szelet', 25]] },
  { name: 'Kifli', group: 'Gabona, pékáru', kcal: 290, protein: 9, carbs: 54, fat: 3.5, portions: [['1 db', 50]] },
  { name: 'Zsemle', group: 'Gabona, pékáru', kcal: 270, protein: 9, carbs: 52, fat: 2.5, portions: [['1 db', 50]] },
  { name: 'Bagett', group: 'Gabona, pékáru', kcal: 270, protein: 9, carbs: 52, fat: 2, portions: [['1 szelet', 40]] },
  { name: 'Croissant', group: 'Gabona, pékáru', kcal: 400, protein: 8, carbs: 45, fat: 21, portions: [['1 db', 60]] },
  { name: 'Kalács', group: 'Gabona, pékáru', kcal: 330, protein: 9, carbs: 55, fat: 9, portions: [['1 szelet', 40]] },
  { name: 'Pogácsa', group: 'Gabona, pékáru', kcal: 420, protein: 8, carbs: 45, fat: 23, portions: [['1 db', 40]] },
  { name: 'Bukta', group: 'Gabona, pékáru', kcal: 300, protein: 7, carbs: 50, fat: 8, portions: [['1 db', 90]] },
  { name: 'Tortilla lap (búza)', group: 'Gabona, pékáru', kcal: 300, protein: 8, carbs: 50, fat: 7, portions: [['1 db', 60]] },
  { name: 'Pita kenyér', group: 'Gabona, pékáru', kcal: 275, protein: 9, carbs: 55, fat: 1.2, portions: [['1 db', 60]] },
  { name: 'Puffasztott rizs szelet', group: 'Gabona, pékáru', kcal: 380, protein: 8, carbs: 81, fat: 3, portions: [['1 db', 8]] },
  { name: 'Zsemlemorzsa', group: 'Gabona, pékáru', kcal: 350, protein: 12, carbs: 70, fat: 3, portions: [['1 evőkanál', 12]] },
  { name: 'Zabpehely', group: 'Gabona, pékáru', kcal: 375, protein: 13, carbs: 60, fat: 7, portions: [['1 adag', 50], ['1 bögre', 90]] },
  { name: 'Zabkorpa', group: 'Gabona, pékáru', kcal: 245, protein: 17, carbs: 50, fat: 7, portions: [['1 evőkanál', 10]] },
  { name: 'Búzakorpa', group: 'Gabona, pékáru', kcal: 216, protein: 16, carbs: 64, fat: 4, portions: [['1 evőkanál', 8]] },
  { name: 'Müzli (natúr)', group: 'Gabona, pékáru', kcal: 360, protein: 10, carbs: 60, fat: 8, portions: [['1 adag', 50]] },
  { name: 'Granola', group: 'Gabona, pékáru', kcal: 450, protein: 9, carbs: 60, fat: 18, portions: [['1 adag', 50]] },
  { name: 'Kukoricapehely', group: 'Gabona, pékáru', kcal: 380, protein: 7, carbs: 84, fat: 0.9, portions: [['1 adag', 30]] },
  { name: 'Puffasztott rizs', group: 'Gabona, pékáru', kcal: 390, protein: 7, carbs: 87, fat: 1, portions: [['1 adag', 30]] },
  { name: 'Búzaliszt (BL55)', group: 'Gabona, pékáru', kcal: 345, protein: 10, carbs: 72, fat: 1, portions: [['1 evőkanál', 10]] },
  { name: 'Teljes kiőrlésű liszt', group: 'Gabona, pékáru', kcal: 330, protein: 13, carbs: 60, fat: 2.5, portions: [['1 evőkanál', 10]] },
  { name: 'Kukoricaliszt', group: 'Gabona, pékáru', kcal: 360, protein: 7, carbs: 76, fat: 1.5 },
  { name: 'Rizsliszt', group: 'Gabona, pékáru', kcal: 366, protein: 6, carbs: 80, fat: 1.4 },
  { name: 'Mandulaliszt', group: 'Gabona, pékáru', kcal: 600, protein: 21, carbs: 10, fat: 54, portions: [['1 evőkanál', 10]] },

  /* ==================================================================
     Köret, burgonya
     ================================================================== */
  { name: 'Fehér rizs (főtt)', group: 'Köret, burgonya', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, portions: [['1 adag', 200]] },
  { name: 'Fehér rizs (nyers)', group: 'Köret, burgonya', kcal: 355, protein: 7, carbs: 79, fat: 0.9, portions: [['1 adag (száraz)', 70]] },
  { name: 'Barna rizs (főtt)', group: 'Köret, burgonya', kcal: 123, protein: 2.6, carbs: 26, fat: 1, portions: [['1 adag', 200]] },
  { name: 'Jázmin rizs (főtt)', group: 'Köret, burgonya', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, portions: [['1 adag', 200]] },
  { name: 'Basmati rizs (főtt)', group: 'Köret, burgonya', kcal: 120, protein: 3, carbs: 25, fat: 0.4, portions: [['1 adag', 200]] },
  { name: 'Tészta (főtt)', group: 'Köret, burgonya', kcal: 158, protein: 6, carbs: 31, fat: 0.9, portions: [['1 adag', 250]] },
  { name: 'Tészta (nyers, durum)', group: 'Köret, burgonya', kcal: 355, protein: 12, carbs: 71, fat: 1.5, portions: [['1 adag (száraz)', 80]] },
  { name: 'Teljes kiőrlésű tészta (főtt)', group: 'Köret, burgonya', kcal: 145, protein: 6, carbs: 27, fat: 1.2, portions: [['1 adag', 250]] },
  { name: 'Spagetti (főtt)', group: 'Köret, burgonya', kcal: 158, protein: 6, carbs: 31, fat: 0.9, portions: [['1 adag', 250]] },
  { name: 'Bulgur (főtt)', group: 'Köret, burgonya', kcal: 83, protein: 3, carbs: 19, fat: 0.2, portions: [['1 adag', 200]] },
  { name: 'Kuszkusz (főtt)', group: 'Köret, burgonya', kcal: 112, protein: 3.8, carbs: 23, fat: 0.2, portions: [['1 adag', 200]] },
  { name: 'Quinoa (főtt)', group: 'Köret, burgonya', kcal: 120, protein: 4.4, carbs: 21, fat: 1.9, portions: [['1 adag', 200]] },
  { name: 'Hajdina (főtt)', group: 'Köret, burgonya', kcal: 92, protein: 3.4, carbs: 20, fat: 0.6, portions: [['1 adag', 200]] },
  { name: 'Köles (főtt)', group: 'Köret, burgonya', kcal: 119, protein: 3.5, carbs: 23, fat: 1, portions: [['1 adag', 200]] },
  { name: 'Árpagyöngy (főtt)', group: 'Köret, burgonya', kcal: 123, protein: 2.3, carbs: 28, fat: 0.4, portions: [['1 adag', 200]] },
  { name: 'Polenta (főtt)', group: 'Köret, burgonya', kcal: 85, protein: 2, carbs: 18, fat: 0.4, portions: [['1 adag', 200]] },
  { name: 'Gnocchi', group: 'Köret, burgonya', kcal: 160, protein: 4, carbs: 32, fat: 1, portions: [['1 adag', 250]] },
  { name: 'Nokedli', group: 'Köret, burgonya', kcal: 160, protein: 5, carbs: 30, fat: 2, portions: [['1 adag', 200]] },
  { name: 'Tarhonya (főtt)', group: 'Köret, burgonya', kcal: 150, protein: 5, carbs: 29, fat: 1.5, portions: [['1 adag', 200]] },
  { name: 'Rizibizi', group: 'Köret, burgonya', kcal: 130, protein: 4, carbs: 24, fat: 2, portions: [['1 adag', 200]] },
  { name: 'Burgonya (főtt)', group: 'Köret, burgonya', kcal: 87, protein: 2, carbs: 20, fat: 0.1, portions: [['1 közepes', 150]] },
  { name: 'Burgonya (sült)', group: 'Köret, burgonya', kcal: 150, protein: 2.5, carbs: 28, fat: 3.5, portions: [['1 adag', 200]] },
  { name: 'Hasábburgonya', group: 'Köret, burgonya', kcal: 290, protein: 3.5, carbs: 38, fat: 14, portions: [['1 adag', 150]] },
  { name: 'Burgonyapüré', group: 'Köret, burgonya', kcal: 105, protein: 2, carbs: 15, fat: 4, portions: [['1 adag', 200]] },
  { name: 'Édesburgonya (főtt)', group: 'Köret, burgonya', kcal: 90, protein: 2, carbs: 21, fat: 0.1, portions: [['1 közepes', 150]] },

  /* ==================================================================
     Hüvelyes, növényi fehérje
     ================================================================== */
  { name: 'Vörös lencse (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 116, protein: 9, carbs: 20, fat: 0.4, portions: [['1 adag', 200]] },
  { name: 'Barna lencse (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 116, protein: 9, carbs: 20, fat: 0.4, portions: [['1 adag', 200]] },
  { name: 'Csicseriborsó (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 164, protein: 9, carbs: 27, fat: 2.6, portions: [['1 adag', 150]] },
  { name: 'Vörösbab (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 127, protein: 9, carbs: 23, fat: 0.5, portions: [['1 adag', 150]] },
  { name: 'Fehérbab (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 140, protein: 9.7, carbs: 25, fat: 0.5, portions: [['1 adag', 150]] },
  { name: 'Fekete bab (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 132, protein: 9, carbs: 24, fat: 0.5, portions: [['1 adag', 150]] },
  { name: 'Zöldborsó (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 84, protein: 5.4, carbs: 14, fat: 0.4, portions: [['1 adag', 150]] },
  { name: 'Sárgaborsó (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 118, protein: 8, carbs: 21, fat: 0.4, portions: [['1 adag', 150]] },
  { name: 'Szójabab (főtt)', group: 'Hüvelyes, növényi fehérje', kcal: 172, protein: 18, carbs: 8, fat: 9, portions: [['1 adag', 150]] },
  { name: 'Edamame', group: 'Hüvelyes, növényi fehérje', kcal: 121, protein: 12, carbs: 9, fat: 5, portions: [['1 adag', 150]] },
  { name: 'Tofu (natúr)', group: 'Hüvelyes, növényi fehérje', kcal: 76, protein: 8, carbs: 1.9, fat: 4.8, portions: [['1 szelet', 100]] },
  { name: 'Füstölt tofu', group: 'Hüvelyes, növényi fehérje', kcal: 145, protein: 16, carbs: 2, fat: 8, portions: [['1 csomag', 200]] },
  { name: 'Tempeh', group: 'Hüvelyes, növényi fehérje', kcal: 190, protein: 19, carbs: 9, fat: 11, portions: [['1 adag', 100]] },
  { name: 'Szójakocka (száraz)', group: 'Hüvelyes, növényi fehérje', kcal: 340, protein: 50, carbs: 30, fat: 1, portions: [['1 adag (száraz)', 30]] },
  { name: 'Szejtán', group: 'Hüvelyes, növényi fehérje', kcal: 140, protein: 25, carbs: 6, fat: 2, portions: [['1 adag', 100]] },
  { name: 'Húspótló darált (szója)', group: 'Hüvelyes, növényi fehérje', kcal: 130, protein: 17, carbs: 5, fat: 4 },
  { name: 'Növényi burger pogácsa', group: 'Hüvelyes, növényi fehérje', kcal: 200, protein: 17, carbs: 8, fat: 11, portions: [['1 db', 100]] },
  { name: 'Növényi felvágott', group: 'Hüvelyes, növényi fehérje', kcal: 180, protein: 15, carbs: 8, fat: 10, portions: [['1 szelet', 20]] },
  { name: 'Hummusz', group: 'Hüvelyes, növényi fehérje', kcal: 230, protein: 8, carbs: 14, fat: 17, portions: [['1 evőkanál', 25]] },
  { name: 'Élesztőpehely', group: 'Hüvelyes, növényi fehérje', kcal: 350, protein: 45, carbs: 20, fat: 5, portions: [['1 evőkanál', 5]] },
  { name: 'Mandulaital (cukormentes)', group: 'Hüvelyes, növényi fehérje', unit: 'ml', kcal: 15, protein: 0.5, carbs: 0.3, fat: 1.2, portions: [['1 pohár', 250]] },
  { name: 'Szójaital (natúr)', group: 'Hüvelyes, növényi fehérje', unit: 'ml', kcal: 40, protein: 3.3, carbs: 2.5, fat: 1.8, portions: [['1 pohár', 250]] },
  { name: 'Zabital', group: 'Hüvelyes, növényi fehérje', unit: 'ml', kcal: 45, protein: 0.5, carbs: 7, fat: 1.5, portions: [['1 pohár', 250]] },
  { name: 'Rizsital', group: 'Hüvelyes, növényi fehérje', unit: 'ml', kcal: 50, protein: 0.3, carbs: 10, fat: 1, portions: [['1 pohár', 250]] },
  { name: 'Kókuszital', group: 'Hüvelyes, növényi fehérje', unit: 'ml', kcal: 20, protein: 0.2, carbs: 3, fat: 0.9, portions: [['1 pohár', 250]] },
  { name: 'Növényi joghurt (szója)', group: 'Hüvelyes, növényi fehérje', kcal: 55, protein: 4, carbs: 3, fat: 2.5, portions: [['1 pohár', 150]] },

  /* ==================================================================
     Zöldség
     ================================================================== */
  { name: 'Paradicsom', group: 'Zöldség', kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, portions: [['1 db', 120]] },
  { name: 'Koktélparadicsom', group: 'Zöldség', kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, portions: [['1 db', 15]] },
  { name: 'Uborka', group: 'Zöldség', kcal: 15, protein: 0.7, carbs: 3.6, fat: 0.1, portions: [['1 db', 300]] },
  { name: 'Savanyú uborka', group: 'Zöldség', kcal: 12, protein: 0.6, carbs: 2.3, fat: 0.2, portions: [['1 db', 40]] },
  { name: 'Tv-paprika', group: 'Zöldség', kcal: 26, protein: 1, carbs: 6, fat: 0.3, portions: [['1 db', 100]] },
  { name: 'Kaliforniai paprika', group: 'Zöldség', kcal: 31, protein: 1, carbs: 6, fat: 0.3, portions: [['1 db', 150]] },
  { name: 'Hegyes erős paprika', group: 'Zöldség', kcal: 40, protein: 2, carbs: 9, fat: 0.4, portions: [['1 db', 25]] },
  { name: 'Fejes saláta', group: 'Zöldség', kcal: 15, protein: 1.4, carbs: 2.9, fat: 0.2, portions: [['1 adag', 80]] },
  { name: 'Jégsaláta', group: 'Zöldség', kcal: 14, protein: 0.9, carbs: 3, fat: 0.1, portions: [['1 adag', 80]] },
  { name: 'Rukkola', group: 'Zöldség', kcal: 25, protein: 2.6, carbs: 3.7, fat: 0.7, portions: [['1 adag', 40]] },
  { name: 'Spenót', group: 'Zöldség', kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, portions: [['1 adag', 100]] },
  { name: 'Sóska', group: 'Zöldség', kcal: 22, protein: 2, carbs: 3, fat: 0.7 },
  { name: 'Fehér káposzta', group: 'Zöldség', kcal: 25, protein: 1.3, carbs: 6, fat: 0.1, portions: [['1 adag', 150]] },
  { name: 'Vörös káposzta', group: 'Zöldség', kcal: 31, protein: 1.4, carbs: 7, fat: 0.2, portions: [['1 adag', 150]] },
  { name: 'Kelkáposzta', group: 'Zöldség', kcal: 49, protein: 3.3, carbs: 6, fat: 0.4, portions: [['1 adag', 150]] },
  { name: 'Kelbimbó', group: 'Zöldség', kcal: 43, protein: 3.4, carbs: 9, fat: 0.3, portions: [['1 adag', 150]] },
  { name: 'Savanyú káposzta', group: 'Zöldség', kcal: 19, protein: 0.9, carbs: 4.3, fat: 0.1, portions: [['1 adag', 150]] },
  { name: 'Brokkoli', group: 'Zöldség', kcal: 34, protein: 2.8, carbs: 7, fat: 0.4, portions: [['1 adag', 150]] },
  { name: 'Karfiol', group: 'Zöldség', kcal: 25, protein: 1.9, carbs: 5, fat: 0.3, portions: [['1 adag', 150]] },
  { name: 'Sárgarépa', group: 'Zöldség', kcal: 41, protein: 0.9, carbs: 10, fat: 0.2, portions: [['1 db', 80]] },
  { name: 'Fehérrépa', group: 'Zöldség', kcal: 36, protein: 1.5, carbs: 8, fat: 0.5, portions: [['1 db', 60]] },
  { name: 'Zellergumó', group: 'Zöldség', kcal: 42, protein: 1.5, carbs: 9, fat: 0.3 },
  { name: 'Cékla', group: 'Zöldség', kcal: 43, protein: 1.6, carbs: 10, fat: 0.2, portions: [['1 adag', 150]] },
  { name: 'Retek', group: 'Zöldség', kcal: 16, protein: 0.7, carbs: 3.4, fat: 0.1, portions: [['1 csomó', 100]] },
  { name: 'Karalábé', group: 'Zöldség', kcal: 27, protein: 1.7, carbs: 6, fat: 0.1, portions: [['1 db', 150]] },
  { name: 'Vöröshagyma', group: 'Zöldség', kcal: 40, protein: 1.1, carbs: 9, fat: 0.1, portions: [['1 db', 100]] },
  { name: 'Lilahagyma', group: 'Zöldség', kcal: 40, protein: 1.1, carbs: 9, fat: 0.1, portions: [['1 db', 100]] },
  { name: 'Újhagyma', group: 'Zöldség', kcal: 32, protein: 1.8, carbs: 7, fat: 0.2, portions: [['1 csomó', 60]] },
  { name: 'Fokhagyma', group: 'Zöldség', kcal: 149, protein: 6.4, carbs: 33, fat: 0.5, portions: [['1 gerezd', 3]] },
  { name: 'Póréhagyma', group: 'Zöldség', kcal: 61, protein: 1.5, carbs: 14, fat: 0.3, portions: [['1 szál', 100]] },
  { name: 'Cukkini', group: 'Zöldség', kcal: 17, protein: 1.2, carbs: 3.1, fat: 0.3, portions: [['1 db', 200]] },
  { name: 'Padlizsán', group: 'Zöldség', kcal: 25, protein: 1, carbs: 6, fat: 0.2, portions: [['1 db', 250]] },
  { name: 'Sütőtök', group: 'Zöldség', kcal: 26, protein: 1, carbs: 6.5, fat: 0.1, portions: [['1 adag', 200]] },
  { name: 'Főzőtök', group: 'Zöldség', kcal: 20, protein: 0.8, carbs: 4, fat: 0.1, portions: [['1 adag', 200]] },
  { name: 'Csemegekukorica', group: 'Zöldség', kcal: 86, protein: 3.2, carbs: 19, fat: 1.2, portions: [['1 konzerv', 285], ['1 cső', 150]] },
  { name: 'Zöldbab', group: 'Zöldség', kcal: 31, protein: 1.8, carbs: 7, fat: 0.1, portions: [['1 adag', 150]] },
  { name: 'Spárga', group: 'Zöldség', kcal: 20, protein: 2.2, carbs: 3.9, fat: 0.1, portions: [['1 adag', 150]] },
  { name: 'Cukorborsó', group: 'Zöldség', kcal: 42, protein: 2.8, carbs: 7.5, fat: 0.2, portions: [['1 adag', 100]] },
  { name: 'Csiperkegomba', group: 'Zöldség', kcal: 22, protein: 3.1, carbs: 3.3, fat: 0.3, portions: [['1 adag', 150]] },
  { name: 'Laskagomba', group: 'Zöldség', kcal: 33, protein: 3.3, carbs: 6, fat: 0.4, portions: [['1 adag', 150]] },
  { name: 'Shiitake gomba', group: 'Zöldség', kcal: 34, protein: 2.2, carbs: 7, fat: 0.5 },
  { name: 'Avokádó', group: 'Zöldség', kcal: 160, protein: 2, carbs: 9, fat: 15, portions: [['1 db', 200], ['fél db', 100]] },
  { name: 'Olívabogyó', group: 'Zöldség', kcal: 145, protein: 1, carbs: 6, fat: 15, portions: [['1 db', 4]] },
  { name: 'Torma', group: 'Zöldség', kcal: 48, protein: 1.2, carbs: 11, fat: 0.7, portions: [['1 evőkanál', 15]] },
  { name: 'Petrezselyemzöld', group: 'Zöldség', kcal: 36, protein: 3, carbs: 6, fat: 0.8, portions: [['1 evőkanál', 4]] },
  { name: 'Kapor', group: 'Zöldség', kcal: 43, protein: 3.5, carbs: 7, fat: 1.1 },
  { name: 'Bazsalikom', group: 'Zöldség', kcal: 23, protein: 3.2, carbs: 2.7, fat: 0.6 },
  { name: 'Lucernacsíra', group: 'Zöldség', kcal: 23, protein: 4, carbs: 2, fat: 0.7 },
  { name: 'Paradicsompüré', group: 'Zöldség', kcal: 82, protein: 4.3, carbs: 19, fat: 0.5, portions: [['1 evőkanál', 15]] },
  { name: 'Passzírozott paradicsom', group: 'Zöldség', kcal: 32, protein: 1.6, carbs: 7, fat: 0.2, portions: [['1 doboz', 400]] },

  /* ==================================================================
     Gyümölcs
     ================================================================== */
  { name: 'Alma', group: 'Gyümölcs', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, portions: [['1 db', 180]] },
  { name: 'Körte', group: 'Gyümölcs', kcal: 57, protein: 0.4, carbs: 15, fat: 0.1, portions: [['1 db', 180]] },
  { name: 'Banán', group: 'Gyümölcs', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, portions: [['1 db', 120]] },
  { name: 'Narancs', group: 'Gyümölcs', kcal: 47, protein: 0.9, carbs: 12, fat: 0.1, portions: [['1 db', 200]] },
  { name: 'Mandarin', group: 'Gyümölcs', kcal: 53, protein: 0.8, carbs: 13, fat: 0.3, portions: [['1 db', 90]] },
  { name: 'Citrom', group: 'Gyümölcs', kcal: 29, protein: 1.1, carbs: 9, fat: 0.3, portions: [['1 db', 100]] },
  { name: 'Grapefruit', group: 'Gyümölcs', kcal: 42, protein: 0.8, carbs: 11, fat: 0.1, portions: [['1 db', 250]] },
  { name: 'Szőlő', group: 'Gyümölcs', kcal: 69, protein: 0.7, carbs: 18, fat: 0.2, portions: [['1 fürt', 150]] },
  { name: 'Eper', group: 'Gyümölcs', kcal: 32, protein: 0.7, carbs: 7.7, fat: 0.3, portions: [['1 adag', 150]] },
  { name: 'Málna', group: 'Gyümölcs', kcal: 52, protein: 1.2, carbs: 12, fat: 0.7, portions: [['1 adag', 125]] },
  { name: 'Áfonya', group: 'Gyümölcs', kcal: 57, protein: 0.7, carbs: 14, fat: 0.3, portions: [['1 adag', 125]] },
  { name: 'Ribizli', group: 'Gyümölcs', kcal: 56, protein: 1.4, carbs: 14, fat: 0.2, portions: [['1 adag', 125]] },
  { name: 'Szeder', group: 'Gyümölcs', kcal: 43, protein: 1.4, carbs: 10, fat: 0.5, portions: [['1 adag', 125]] },
  { name: 'Egres', group: 'Gyümölcs', kcal: 44, protein: 0.9, carbs: 10, fat: 0.6 },
  { name: 'Meggy', group: 'Gyümölcs', kcal: 50, protein: 1, carbs: 12, fat: 0.3, portions: [['1 adag', 150]] },
  { name: 'Cseresznye', group: 'Gyümölcs', kcal: 63, protein: 1, carbs: 16, fat: 0.2, portions: [['1 adag', 150]] },
  { name: 'Őszibarack', group: 'Gyümölcs', kcal: 39, protein: 0.9, carbs: 10, fat: 0.3, portions: [['1 db', 150]] },
  { name: 'Sárgabarack', group: 'Gyümölcs', kcal: 48, protein: 1.4, carbs: 11, fat: 0.4, portions: [['1 db', 40]] },
  { name: 'Nektarin', group: 'Gyümölcs', kcal: 44, protein: 1.1, carbs: 11, fat: 0.3, portions: [['1 db', 150]] },
  { name: 'Szilva', group: 'Gyümölcs', kcal: 46, protein: 0.7, carbs: 11, fat: 0.3, portions: [['1 db', 60]] },
  { name: 'Görögdinnye', group: 'Gyümölcs', kcal: 30, protein: 0.6, carbs: 8, fat: 0.2, portions: [['1 szelet', 300]] },
  { name: 'Sárgadinnye', group: 'Gyümölcs', kcal: 34, protein: 0.8, carbs: 8, fat: 0.2, portions: [['1 szelet', 200]] },
  { name: 'Ananász', group: 'Gyümölcs', kcal: 50, protein: 0.5, carbs: 13, fat: 0.1, portions: [['1 karika', 80]] },
  { name: 'Mangó', group: 'Gyümölcs', kcal: 60, protein: 0.8, carbs: 15, fat: 0.4, portions: [['1 db', 200]] },
  { name: 'Kiwi', group: 'Gyümölcs', kcal: 61, protein: 1.1, carbs: 15, fat: 0.5, portions: [['1 db', 75]] },
  { name: 'Gránátalma', group: 'Gyümölcs', kcal: 83, protein: 1.7, carbs: 19, fat: 1.2, portions: [['1 db', 250]] },
  { name: 'Papaya', group: 'Gyümölcs', kcal: 43, protein: 0.5, carbs: 11, fat: 0.3 },
  { name: 'Kaki', group: 'Gyümölcs', kcal: 70, protein: 0.6, carbs: 18, fat: 0.2, portions: [['1 db', 170]] },
  { name: 'Birsalma', group: 'Gyümölcs', kcal: 57, protein: 0.4, carbs: 15, fat: 0.1 },
  { name: 'Füge (friss)', group: 'Gyümölcs', kcal: 74, protein: 0.8, carbs: 19, fat: 0.3, portions: [['1 db', 50]] },
  { name: 'Homoktövis', group: 'Gyümölcs', kcal: 82, protein: 1.4, carbs: 8, fat: 3 },
  { name: 'Kókusz (friss)', group: 'Gyümölcs', kcal: 350, protein: 3.3, carbs: 15, fat: 33 },
  { name: 'Fagyasztott bogyós mix', group: 'Gyümölcs', kcal: 45, protein: 1, carbs: 9, fat: 0.4, portions: [['1 adag', 150]] },
  { name: 'Mazsola', group: 'Gyümölcs', kcal: 300, protein: 3, carbs: 79, fat: 0.5, portions: [['1 marék', 30]] },
  { name: 'Datolya (szárított)', group: 'Gyümölcs', kcal: 280, protein: 2.5, carbs: 75, fat: 0.4, portions: [['1 db', 8]] },
  { name: 'Aszalt szilva', group: 'Gyümölcs', kcal: 240, protein: 2.2, carbs: 64, fat: 0.4, portions: [['1 db', 10]] },
  { name: 'Aszalt sárgabarack', group: 'Gyümölcs', kcal: 240, protein: 3.4, carbs: 63, fat: 0.5, portions: [['1 db', 8]] },
  { name: 'Füge (aszalt)', group: 'Gyümölcs', kcal: 250, protein: 3.3, carbs: 64, fat: 0.9, portions: [['1 db', 20]] },
  { name: 'Banánchips', group: 'Gyümölcs', kcal: 520, protein: 2.3, carbs: 58, fat: 30, portions: [['1 marék', 30]] },

  /* ==================================================================
     Olajos mag
     ================================================================== */
  { name: 'Mandula', group: 'Olajos mag', kcal: 580, protein: 21, carbs: 9, fat: 50, portions: [['1 marék', 30], ['1 db', 1.2]] },
  { name: 'Dió', group: 'Olajos mag', kcal: 654, protein: 15, carbs: 14, fat: 65, portions: [['1 marék', 30]] },
  { name: 'Mogyoró', group: 'Olajos mag', kcal: 628, protein: 15, carbs: 17, fat: 61, portions: [['1 marék', 30]] },
  { name: 'Kesudió', group: 'Olajos mag', kcal: 553, protein: 18, carbs: 30, fat: 44, portions: [['1 marék', 30]] },
  { name: 'Pisztácia', group: 'Olajos mag', kcal: 560, protein: 20, carbs: 28, fat: 45, portions: [['1 marék', 30]] },
  { name: 'Földimogyoró', group: 'Olajos mag', kcal: 567, protein: 26, carbs: 16, fat: 49, portions: [['1 marék', 30]] },
  { name: 'Pekándió', group: 'Olajos mag', kcal: 690, protein: 9, carbs: 14, fat: 72, portions: [['1 marék', 30]] },
  { name: 'Paradió', group: 'Olajos mag', kcal: 656, protein: 14, carbs: 12, fat: 66, portions: [['1 db', 5]] },
  { name: 'Makadámia', group: 'Olajos mag', kcal: 718, protein: 8, carbs: 14, fat: 76, portions: [['1 marék', 30]] },
  { name: 'Napraforgómag', group: 'Olajos mag', kcal: 584, protein: 21, carbs: 20, fat: 51, portions: [['1 marék', 30]] },
  { name: 'Tökmag', group: 'Olajos mag', kcal: 559, protein: 30, carbs: 11, fat: 49, portions: [['1 marék', 30]] },
  { name: 'Szezámmag', group: 'Olajos mag', kcal: 573, protein: 18, carbs: 23, fat: 50, portions: [['1 evőkanál', 9]] },
  { name: 'Lenmag', group: 'Olajos mag', kcal: 534, protein: 18, carbs: 29, fat: 42, portions: [['1 evőkanál', 10]] },
  { name: 'Chia mag', group: 'Olajos mag', kcal: 486, protein: 17, carbs: 42, fat: 31, portions: [['1 evőkanál', 12]] },
  { name: 'Mákszem', group: 'Olajos mag', kcal: 525, protein: 18, carbs: 28, fat: 42, portions: [['1 evőkanál', 9]] },
  { name: 'Kendermag', group: 'Olajos mag', kcal: 553, protein: 32, carbs: 8, fat: 49, portions: [['1 evőkanál', 10]] },
  { name: 'Kókuszreszelék', group: 'Olajos mag', kcal: 660, protein: 7, carbs: 24, fat: 65, portions: [['1 evőkanál', 8]] },
  { name: 'Mogyoróvaj', group: 'Olajos mag', kcal: 588, protein: 25, carbs: 20, fat: 50, portions: [['1 evőkanál', 16]] },
  { name: 'Mandulavaj', group: 'Olajos mag', kcal: 614, protein: 21, carbs: 19, fat: 56, portions: [['1 evőkanál', 16]] },
  { name: 'Tahini', group: 'Olajos mag', kcal: 595, protein: 17, carbs: 21, fat: 54, portions: [['1 evőkanál', 15]] },

  /* ==================================================================
     Olaj, zsiradék
     ================================================================== */
  { name: 'Olívaolaj', group: 'Olaj, zsiradék', unit: 'ml', kcal: 884, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 14], ['1 teáskanál', 5]] },
  { name: 'Napraforgóolaj', group: 'Olaj, zsiradék', unit: 'ml', kcal: 884, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 14]] },
  { name: 'Repceolaj', group: 'Olaj, zsiradék', unit: 'ml', kcal: 884, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 14]] },
  { name: 'Kókuszolaj', group: 'Olaj, zsiradék', kcal: 862, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 14]] },
  { name: 'Szezámolaj', group: 'Olaj, zsiradék', unit: 'ml', kcal: 884, protein: 0, carbs: 0, fat: 100, portions: [['1 teáskanál', 5]] },
  { name: 'Lenmagolaj', group: 'Olaj, zsiradék', unit: 'ml', kcal: 884, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 14]] },
  { name: 'Sertészsír', group: 'Olaj, zsiradék', kcal: 900, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 13]] },
  { name: 'Kacsazsír', group: 'Olaj, zsiradék', kcal: 900, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 13]] },
  { name: 'Ghee', group: 'Olaj, zsiradék', kcal: 900, protein: 0, carbs: 0, fat: 100, portions: [['1 evőkanál', 13]] },

  /* ==================================================================
     Édesség, snack
     ================================================================== */
  { name: 'Étcsokoládé (70%)', group: 'Édesség, snack', kcal: 550, protein: 8, carbs: 33, fat: 42, portions: [['1 kocka', 10], ['1 tábla', 100]] },
  { name: 'Tejcsokoládé', group: 'Édesség, snack', kcal: 535, protein: 7, carbs: 58, fat: 30, portions: [['1 kocka', 10], ['1 tábla', 100]] },
  { name: 'Fehér csokoládé', group: 'Édesség, snack', kcal: 540, protein: 6, carbs: 59, fat: 32, portions: [['1 kocka', 10]] },
  { name: 'Kakaópor (cukrozatlan)', group: 'Édesség, snack', kcal: 230, protein: 20, carbs: 58, fat: 14, portions: [['1 evőkanál', 6]] },
  { name: 'Mogyorókrém (Nutella-típus)', group: 'Édesség, snack', kcal: 539, protein: 6, carbs: 57, fat: 31, portions: [['1 evőkanál', 20]] },
  { name: 'Mézeskalács', group: 'Édesség, snack', kcal: 380, protein: 5, carbs: 70, fat: 9, portions: [['1 db', 25]] },
  { name: 'Háztartási keksz', group: 'Édesség, snack', kcal: 430, protein: 8, carbs: 72, fat: 12, portions: [['1 db', 10]] },
  { name: 'Vajas keksz', group: 'Édesség, snack', kcal: 480, protein: 6, carbs: 64, fat: 22, portions: [['1 db', 12]] },
  { name: 'Kakaós szendvicskeksz', group: 'Édesség, snack', kcal: 480, protein: 5, carbs: 71, fat: 20, portions: [['1 db', 11]] },
  { name: 'Csokis croissant', group: 'Édesség, snack', kcal: 430, protein: 7, carbs: 48, fat: 23, portions: [['1 db', 70]] },
  { name: 'Fánk', group: 'Édesség, snack', kcal: 400, protein: 6, carbs: 50, fat: 20, portions: [['1 db', 70]] },
  { name: 'Muffin', group: 'Édesség, snack', kcal: 380, protein: 5, carbs: 50, fat: 18, portions: [['1 db', 80]] },
  { name: 'Palacsinta (üres)', group: 'Édesség, snack', kcal: 210, protein: 6, carbs: 28, fat: 8, portions: [['1 db', 60]] },
  { name: 'Túrós rétes', group: 'Édesség, snack', kcal: 280, protein: 6, carbs: 33, fat: 14, portions: [['1 szelet', 120]] },
  { name: 'Meggyes rétes', group: 'Édesség, snack', kcal: 250, protein: 4, carbs: 35, fat: 10, portions: [['1 szelet', 120]] },
  { name: 'Almás pite', group: 'Édesség, snack', kcal: 240, protein: 3, carbs: 35, fat: 10, portions: [['1 szelet', 120]] },
  { name: 'Dobostorta', group: 'Édesség, snack', kcal: 380, protein: 5, carbs: 45, fat: 20, portions: [['1 szelet', 100]] },
  { name: 'Somlói galuska', group: 'Édesség, snack', kcal: 260, protein: 4, carbs: 35, fat: 12, portions: [['1 adag', 150]] },
  { name: 'Méz', group: 'Édesség, snack', kcal: 304, protein: 0.3, carbs: 82, fat: 0, portions: [['1 evőkanál', 21], ['1 teáskanál', 7]] },
  { name: 'Baracklekvár', group: 'Édesség, snack', kcal: 250, protein: 0.4, carbs: 62, fat: 0.1, portions: [['1 evőkanál', 20]] },
  { name: 'Kristálycukor', group: 'Édesség, snack', kcal: 400, protein: 0, carbs: 100, fat: 0, portions: [['1 teáskanál', 4], ['1 evőkanál', 12]] },
  { name: 'Barna cukor', group: 'Édesség, snack', kcal: 380, protein: 0, carbs: 98, fat: 0, portions: [['1 teáskanál', 4]] },
  { name: 'Nyírfacukor (xilit)', group: 'Édesség, snack', kcal: 240, protein: 0, carbs: 100, fat: 0, portions: [['1 teáskanál', 4]] },
  { name: 'Eritrit', group: 'Édesség, snack', kcal: 0, protein: 0, carbs: 0, fat: 0, portions: [['1 teáskanál', 4]] },
  { name: 'Burgonyachips', group: 'Édesség, snack', kcal: 540, protein: 6, carbs: 53, fat: 34, portions: [['1 zacskó', 60]] },
  { name: 'Sós mogyoró', group: 'Édesség, snack', kcal: 600, protein: 24, carbs: 16, fat: 50, portions: [['1 marék', 30]] },
  { name: 'Sós rúd', group: 'Édesség, snack', kcal: 380, protein: 10, carbs: 74, fat: 4, portions: [['1 marék', 25]] },
  { name: 'Pattogatott kukorica', group: 'Édesség, snack', kcal: 480, protein: 9, carbs: 57, fat: 25, portions: [['1 adag', 50]] },
  { name: 'Gumicukor', group: 'Édesség, snack', kcal: 340, protein: 6, carbs: 78, fat: 0.2, portions: [['1 marék', 30]] },
  { name: 'Müzliszelet', group: 'Édesség, snack', kcal: 400, protein: 6, carbs: 65, fat: 12, portions: [['1 db', 25]] },

  /* ==================================================================
     Ital
     ================================================================== */
  { name: 'Víz', group: 'Ital', unit: 'ml', kcal: 0, protein: 0, carbs: 0, fat: 0, portions: [['1 pohár', 250], ['1 palack', 500]] },
  { name: 'Ásványvíz', group: 'Ital', unit: 'ml', kcal: 0, protein: 0, carbs: 0, fat: 0, portions: [['1 pohár', 250], ['1 palack', 500]] },
  { name: 'Szódavíz', group: 'Ital', unit: 'ml', kcal: 0, protein: 0, carbs: 0, fat: 0, portions: [['1 pohár', 250]] },
  { name: 'Fekete kávé', group: 'Ital', unit: 'ml', kcal: 2, protein: 0.1, carbs: 0, fat: 0, portions: [['1 csésze', 120]] },
  { name: 'Tejeskávé', group: 'Ital', unit: 'ml', kcal: 40, protein: 2, carbs: 4, fat: 1.5, portions: [['1 csésze', 200]] },
  { name: 'Cappuccino', group: 'Ital', unit: 'ml', kcal: 55, protein: 3, carbs: 5, fat: 2.5, portions: [['1 csésze', 180]] },
  { name: 'Tea (cukor nélkül)', group: 'Ital', unit: 'ml', kcal: 1, protein: 0, carbs: 0.2, fat: 0, portions: [['1 bögre', 250]] },
  { name: 'Narancslé (100%)', group: 'Ital', unit: 'ml', kcal: 45, protein: 0.7, carbs: 10, fat: 0.2, portions: [['1 pohár', 250]] },
  { name: 'Almalé (100%)', group: 'Ital', unit: 'ml', kcal: 46, protein: 0.1, carbs: 11, fat: 0.1, portions: [['1 pohár', 250]] },
  { name: 'Multivitamin ital', group: 'Ital', unit: 'ml', kcal: 50, protein: 0.3, carbs: 12, fat: 0.1, portions: [['1 pohár', 250]] },
  { name: 'Limonádé', group: 'Ital', unit: 'ml', kcal: 40, protein: 0, carbs: 10, fat: 0, portions: [['1 pohár', 300]] },
  { name: 'Kóla', group: 'Ital', unit: 'ml', kcal: 42, protein: 0, carbs: 10.6, fat: 0, portions: [['1 doboz', 330], ['1 palack', 500]] },
  { name: 'Kóla (cukormentes)', group: 'Ital', unit: 'ml', kcal: 0.3, protein: 0, carbs: 0, fat: 0, portions: [['1 doboz', 330]] },
  { name: 'Energiaital', group: 'Ital', unit: 'ml', kcal: 45, protein: 0, carbs: 11, fat: 0, portions: [['1 doboz', 250]] },
  { name: 'Energiaital (cukormentes)', group: 'Ital', unit: 'ml', kcal: 3, protein: 0, carbs: 0.3, fat: 0, portions: [['1 doboz', 250]] },
  { name: 'Izotóniás ital', group: 'Ital', unit: 'ml', kcal: 25, protein: 0, carbs: 6, fat: 0, portions: [['1 palack', 500]] },
  { name: 'Kombucha', group: 'Ital', unit: 'ml', kcal: 20, protein: 0, carbs: 5, fat: 0, portions: [['1 pohár', 250]] },
  { name: 'Világos sör', group: 'Ital', unit: 'ml', kcal: 43, protein: 0.5, carbs: 3.6, fat: 0, portions: [['1 korsó', 500], ['1 pohár', 300]] },
  { name: 'Száraz vörösbor', group: 'Ital', unit: 'ml', kcal: 85, protein: 0.1, carbs: 2.6, fat: 0, portions: [['1 pohár', 150]] },
  { name: 'Száraz fehérbor', group: 'Ital', unit: 'ml', kcal: 82, protein: 0.1, carbs: 2.6, fat: 0, portions: [['1 pohár', 150]] },
  { name: 'Pezsgő (száraz)', group: 'Ital', unit: 'ml', kcal: 80, protein: 0.1, carbs: 1.4, fat: 0, portions: [['1 pohár', 120]] },
  { name: 'Pálinka (40%)', group: 'Ital', unit: 'ml', kcal: 231, protein: 0, carbs: 0, fat: 0, portions: [['1 kupica', 40]] },
  { name: 'Vodka (40%)', group: 'Ital', unit: 'ml', kcal: 231, protein: 0, carbs: 0, fat: 0, portions: [['1 kupica', 40]] },
  { name: 'Whisky (40%)', group: 'Ital', unit: 'ml', kcal: 250, protein: 0, carbs: 0.1, fat: 0, portions: [['1 adag', 40]] },

  /* ==================================================================
     Sportkiegészítő
     ================================================================== */
  { name: 'Tejsavó fehérjepor (whey)', group: 'Sportkiegészítő', kcal: 380, protein: 78, carbs: 8, fat: 5, portions: [['1 adag', 30], ['1 mérőkanál', 30]] },
  { name: 'Izolátum fehérjepor', group: 'Sportkiegészítő', kcal: 370, protein: 88, carbs: 2, fat: 1, portions: [['1 adag', 30]] },
  { name: 'Kazein fehérjepor', group: 'Sportkiegészítő', kcal: 360, protein: 75, carbs: 6, fat: 2, portions: [['1 adag', 30]] },
  { name: 'Növényi fehérjepor', group: 'Sportkiegészítő', kcal: 380, protein: 72, carbs: 10, fat: 6, portions: [['1 adag', 30]] },
  { name: 'Tömegnövelő (gainer)', group: 'Sportkiegészítő', kcal: 380, protein: 20, carbs: 65, fat: 4, portions: [['1 adag', 100]] },
  { name: 'Kreatin-monohidrát', group: 'Sportkiegészítő', kcal: 0, protein: 0, carbs: 0, fat: 0, portions: [['1 adag', 5]] },
  { name: 'BCAA por', group: 'Sportkiegészítő', kcal: 40, protein: 10, carbs: 0, fat: 0, portions: [['1 adag', 10]] },
  { name: 'Kollagén por', group: 'Sportkiegészítő', kcal: 360, protein: 90, carbs: 0, fat: 0, portions: [['1 adag', 10]] },
  { name: 'Fehérjeturmix (kész)', group: 'Sportkiegészítő', unit: 'ml', kcal: 60, protein: 8, carbs: 4, fat: 1.5, portions: [['1 palack', 330]] },
  { name: 'Fehérjeszelet', group: 'Sportkiegészítő', kcal: 350, protein: 30, carbs: 32, fat: 10, portions: [['1 db', 60]] },
  { name: 'Fehérjés zabkása (kész)', group: 'Sportkiegészítő', kcal: 350, protein: 25, carbs: 45, fat: 6, portions: [['1 adag', 60]] },
  { name: 'Maltodextrin', group: 'Sportkiegészítő', kcal: 380, protein: 0, carbs: 95, fat: 0, portions: [['1 adag', 50]] },
  { name: 'Dextróz', group: 'Sportkiegészítő', kcal: 400, protein: 0, carbs: 100, fat: 0, portions: [['1 adag', 50]] },
  { name: 'Energiazselé', group: 'Sportkiegészítő', kcal: 250, protein: 0, carbs: 62, fat: 0, portions: [['1 tasak', 40]] },

  /* ==================================================================
     Készétel
     ================================================================== */
  { name: 'Gulyásleves', group: 'Készétel', kcal: 60, protein: 4, carbs: 5, fat: 2.5, portions: [['1 tányér', 350]] },
  { name: 'Húsleves', group: 'Készétel', kcal: 30, protein: 2.5, carbs: 3, fat: 1, portions: [['1 tányér', 350]] },
  { name: 'Bableves', group: 'Készétel', kcal: 85, protein: 5, carbs: 11, fat: 2.5, portions: [['1 tányér', 350]] },
  { name: 'Halászlé', group: 'Készétel', kcal: 55, protein: 8, carbs: 2, fat: 1.5, portions: [['1 tányér', 350]] },
  { name: 'Paradicsomleves', group: 'Készétel', kcal: 45, protein: 1, carbs: 8, fat: 1, portions: [['1 tányér', 350]] },
  { name: 'Gombaleves', group: 'Készétel', kcal: 60, protein: 2, carbs: 6, fat: 3, portions: [['1 tányér', 350]] },
  { name: 'Zöldségleves', group: 'Készétel', kcal: 35, protein: 1.5, carbs: 6, fat: 0.5, portions: [['1 tányér', 350]] },
  { name: 'Töltött káposzta', group: 'Készétel', kcal: 130, protein: 8, carbs: 8, fat: 7, portions: [['1 adag', 300]] },
  { name: 'Rakott krumpli', group: 'Készétel', kcal: 165, protein: 8, carbs: 12, fat: 9, portions: [['1 adag', 300]] },
  { name: 'Székelykáposzta', group: 'Készétel', kcal: 120, protein: 8, carbs: 6, fat: 7, portions: [['1 adag', 300]] },
  { name: 'Sertéspörkölt', group: 'Készétel', kcal: 180, protein: 14, carbs: 3, fat: 12, portions: [['1 adag', 250]] },
  { name: 'Marhapörkölt', group: 'Készétel', kcal: 165, protein: 16, carbs: 3, fat: 10, portions: [['1 adag', 250]] },
  { name: 'Csirkepaprikás', group: 'Készétel', kcal: 150, protein: 13, carbs: 4, fat: 9, portions: [['1 adag', 250]] },
  { name: 'Paprikás krumpli', group: 'Készétel', kcal: 110, protein: 4, carbs: 14, fat: 4, portions: [['1 adag', 300]] },
  { name: 'Lecsó', group: 'Készétel', kcal: 60, protein: 2, carbs: 6, fat: 3, portions: [['1 adag', 250]] },
  { name: 'Töltött paprika', group: 'Készétel', kcal: 110, protein: 7, carbs: 9, fat: 5, portions: [['1 db', 200]] },
  { name: 'Húsgombóc paradicsomszósszal', group: 'Készétel', kcal: 150, protein: 10, carbs: 8, fat: 9, portions: [['1 adag', 250]] },
  { name: 'Rántott sertéshús', group: 'Készétel', kcal: 280, protein: 18, carbs: 16, fat: 16, portions: [['1 szelet', 150]] },
  { name: 'Rántott csirkemell', group: 'Készétel', kcal: 240, protein: 20, carbs: 15, fat: 12, portions: [['1 szelet', 150]] },
  { name: 'Rántott sajt', group: 'Készétel', kcal: 320, protein: 16, carbs: 20, fat: 20, portions: [['1 db', 130]] },
  { name: 'Sült krumpli (házi)', group: 'Készétel', kcal: 180, protein: 3, carbs: 28, fat: 6, portions: [['1 adag', 200]] },
  { name: 'Lángos', group: 'Készétel', kcal: 330, protein: 7, carbs: 40, fat: 16, portions: [['1 db', 150]] },
  { name: 'Pizza (margherita)', group: 'Készétel', kcal: 250, protein: 11, carbs: 30, fat: 9, portions: [['1 szelet', 100], ['1 egész', 400]] },
  { name: 'Hamburger (sajtos)', group: 'Készétel', kcal: 260, protein: 13, carbs: 22, fat: 13, portions: [['1 db', 200]] },
  { name: 'Gyros (pitában, csirke)', group: 'Készétel', kcal: 210, protein: 13, carbs: 22, fat: 8, portions: [['1 db', 350]] },
  { name: 'Kebab tál', group: 'Készétel', kcal: 180, protein: 14, carbs: 15, fat: 7, portions: [['1 adag', 400]] },
  { name: 'Spagetti bolognai', group: 'Készétel', kcal: 130, protein: 7, carbs: 16, fat: 4, portions: [['1 adag', 350]] },
  { name: 'Carbonara', group: 'Készétel', kcal: 200, protein: 9, carbs: 18, fat: 10, portions: [['1 adag', 350]] },
  { name: 'Sushi (nigiri, lazac)', group: 'Készétel', kcal: 145, protein: 8, carbs: 24, fat: 2, portions: [['1 db', 30]] },
  { name: 'Görög saláta', group: 'Készétel', kcal: 110, protein: 4, carbs: 5, fat: 8, portions: [['1 adag', 250]] },

  /* ==================================================================
     Fűszer, szósz
     ================================================================== */
  { name: 'Ketchup', group: 'Fűszer, szósz', kcal: 110, protein: 1.2, carbs: 25, fat: 0.2, portions: [['1 evőkanál', 17]] },
  { name: 'Majonéz', group: 'Fűszer, szósz', kcal: 680, protein: 1, carbs: 2, fat: 74, portions: [['1 evőkanál', 15]] },
  { name: 'Mustár', group: 'Fűszer, szósz', kcal: 66, protein: 4, carbs: 6, fat: 3.5, portions: [['1 teáskanál', 5]] },
  { name: 'Szójaszósz', group: 'Fűszer, szósz', unit: 'ml', kcal: 60, protein: 6, carbs: 6, fat: 0.1, portions: [['1 evőkanál', 15]] },
  { name: 'Sriracha', group: 'Fűszer, szósz', kcal: 93, protein: 2, carbs: 19, fat: 1, portions: [['1 teáskanál', 5]] },
  { name: 'BBQ szósz', group: 'Fűszer, szósz', kcal: 170, protein: 0.8, carbs: 41, fat: 0.5, portions: [['1 evőkanál', 17]] },
  { name: 'Tzatziki', group: 'Fűszer, szósz', kcal: 120, protein: 3, carbs: 4, fat: 10, portions: [['1 evőkanál', 20]] },
  { name: 'Fokhagymás öntet', group: 'Fűszer, szósz', kcal: 300, protein: 2, carbs: 6, fat: 30, portions: [['1 evőkanál', 15]] },
  { name: 'Balzsamecet', group: 'Fűszer, szósz', unit: 'ml', kcal: 88, protein: 0.5, carbs: 17, fat: 0, portions: [['1 evőkanál', 15]] },
  { name: 'Ecet (10%)', group: 'Fűszer, szósz', unit: 'ml', kcal: 20, protein: 0, carbs: 0.6, fat: 0, portions: [['1 evőkanál', 15]] },
  { name: 'Só', group: 'Fűszer, szósz', kcal: 0, protein: 0, carbs: 0, fat: 0, portions: [['1 teáskanál', 6]] },
  { name: 'Őrölt bors', group: 'Fűszer, szósz', kcal: 250, protein: 10, carbs: 64, fat: 3, portions: [['1 teáskanál', 2]] },
  { name: 'Fűszerpaprika', group: 'Fűszer, szósz', kcal: 280, protein: 14, carbs: 54, fat: 13, portions: [['1 teáskanál', 2]] },
  { name: 'Oregánó (szárított)', group: 'Fűszer, szósz', kcal: 265, protein: 9, carbs: 69, fat: 4, portions: [['1 teáskanál', 1]] },
  { name: 'Fahéj', group: 'Fűszer, szósz', kcal: 247, protein: 4, carbs: 81, fat: 1.2, portions: [['1 teáskanál', 2]] },
  { name: 'Curry por', group: 'Fűszer, szósz', kcal: 325, protein: 14, carbs: 56, fat: 14, portions: [['1 teáskanál', 2]] },
  { name: 'Friss élesztő', group: 'Fűszer, szósz', kcal: 105, protein: 12, carbs: 12, fat: 2, portions: [['1 kocka', 25]] },
  { name: 'Sütőpor', group: 'Fűszer, szósz', kcal: 100, protein: 0, carbs: 28, fat: 0, portions: [['1 tasak', 12]] },
  { name: 'Zselatin', group: 'Fűszer, szósz', kcal: 340, protein: 86, carbs: 0, fat: 0, portions: [['1 tasak', 10]] },
  { name: 'Kókusztej (konzerv)', group: 'Fűszer, szósz', unit: 'ml', kcal: 200, protein: 2, carbs: 3, fat: 21, portions: [['1 konzerv', 400]] },
];
