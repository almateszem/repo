/**
 * FitTrack Pro — gyakorlat-leírások (magyar)
 * ==========================================
 * Lépésenkénti kivitelezés a katalógus gyakorlataihoz. A kulcs a gyakorlat
 * NEVE (server/data/exercises.hu.js), az érték a lépések tömbje — a
 * server/data/catalog.js olvasztja rá a katalógus soraira `steps` néven, a
 * felület pedig a gyakorlat-választó kártyáján nyitja ki.
 *
 * Miért kézzel írt
 * ----------------
 * A külső dataset tíz nyelven adja a leírásokat, magyarul NEM — és ez az
 * egyetlen olyan mező, amit a nevekkel ellentétben nem lehet kifejezés-
 * szótárral előállítani, mert összefüggő mondatokról van szó. Ezek tehát
 * saját szövegek, nem gépi fordítások.
 *
 * Lefedettség
 * -----------
 * Jelenleg a leggyakrabban használt alapgyakorlatok vannak meg, nem mind az
 * 1400. Aminek nincs leírása, annál a kártya egyszerűen nem mutat kinyitható
 * részt — a gif önmagában is elmondja a mozgást. A lista bővíthető: elég egy
 * új kulcsot felvenni, a nevének pontosan egyeznie kell a katalógusbelivel
 * (a catalog.js induláskor ellenőrzi, és hangosan szól, ha elgépelted).
 *
 * Stílus: felszólító mód, 4-5 lépés, a BEÁLLÍTÁSTÓL a befejezésig. A
 * biztonsági szempont (gerinc, váll, térd) mindig szerepeljen, ha releváns.
 */

export const instructionsHu = {
  /* ==================================================================
     Mell
     ================================================================== */
  'Fekvenyomás': [
    'Feküdj a padra úgy, hogy a szemed nagyjából a rúd alatt legyen. A talpad stabilan a földön, a lapockád húzd össze és le.',
    'Fogd meg a rudat vállnál valamivel szélesebben, a csuklód maradjon egyenes az alkar vonalában.',
    'Emeld ki a rudat, és irányítsd a mellkasod közepe fölé — ez a kiinduló helyzet.',
    'Engedd le a rudat kontrolláltan a mellkasod alsó harmadára, a könyököd nagyjából 45 fokban a törzsedhez képest.',
    'Told vissza a rudat a kiinduló pontig anélkül, hogy a lapockád kinyílna. A rúd ne pattanjon a mellkasodról.',
  ],
  'Ferde fekvenyomás': [
    'Állítsd a padot 30-45 fokos dőlésbe. A meredekebb szög egyre inkább a vállat terheli a felső mell helyett.',
    'Feküdj rá, a lapockád húzd össze és le, a talpad legyen stabilan a földön.',
    'Emeld ki a rudat, és irányítsd a kulcscsontod magasságába.',
    'Engedd le a rudat a felső mellkasodra kontrolláltan, majd told vissza a kiinduló pontig.',
  ],
  'Kézisúlyzós fekvenyomás': [
    'Ülj a pad végére, a súlyzókat támaszd a combodra, majd hanyatt dőlve lendítsd őket a mellkasod fölé.',
    'A lapockád húzd össze és le, a talpad legyen stabilan a földön.',
    'Engedd le a súlyzókat a mellkasod vonaláig, a könyököd ne süllyedjen mélyen a törzsed alá.',
    'Told vissza őket felfelé és kissé egymás felé, de ne üsd össze a súlyzókat a tetőponton.',
  ],
  'Tolódzkodás': [
    'Támaszkodj fel a korlátra nyújtott karral, a vállad legyen távol a füledtől.',
    'A mellizom hangsúlyozásához dőlj előre a törzseddel; ha egyenesen maradsz, a tricepsz kap többet.',
    'Engedd le magad, amíg a felkarod nagyjából párhuzamos nem lesz a talajjal — mélyebbre csak akkor, ha a vállad panasz nélkül bírja.',
    'Told vissza magad a kiinduló helyzetbe, és tartsd feszesen a törzsed végig.',
  ],
  'Gépi mellnyomás': [
    'Állítsd be az ülést úgy, hogy a fogantyú a mellkasod közepének magasságában legyen.',
    'Ülj be, a hátad és a vállad támaszkodjon a háttámlának, a lapockád húzd össze.',
    'Told ki a fogantyút, amíg a karod majdnem nyújtott lesz — a könyököd ne akadjon be teljesen.',
    'Engedd vissza kontrolláltan, amíg enyhe nyújtást érzel a mellizomban.',
  ],
  'Kábeles keresztezés': [
    'Állítsd a csigákat vállmagasság fölé, és fogd meg mindkét fogantyút.',
    'Lépj egyet előre, hogy legyen feszülés a kábelen, a törzsed enyhén dőljön előre.',
    'Enyhén hajlított könyökkel húzd össze a karod a tested előtt, mintha ölelnél.',
    'A tetőponton szorítsd össze a mellizmot egy pillanatra, majd engedd vissza lassan a nyújtott helyzetig.',
  ],
  'Kézisúlyzós tárogatás': [
    'Feküdj a padra, a súlyzókat tartsd a mellkasod fölött enyhén hajlított könyökkel.',
    'Engedd szét a karod oldalra egy széles ívben, a könyök szöge végig maradjon változatlan.',
    'Addig menj, amíg kellemes nyújtást érzel a mellizomban — a vállad ne essen előre.',
    'Ugyanazon az íven hozd vissza a súlyzókat, a mellizom munkájával, nem a karoddal.',
  ],
  'Fekvőtámasz': [
    'Támaszkodj a talajra vállszélességnél kicsit szélesebb kézzel, a tested legyen egyenes vonal a sarkadtól a fejedig.',
    'Feszítsd meg a hasad és a farizmod, hogy a derekad ne lógjon be.',
    'Engedd le magad, amíg a mellkasod majdnem a talajt éri, a könyököd 45 fok körül a törzsedhez képest.',
    'Told vissza magad a kiinduló helyzetbe anélkül, hogy a csípőd megelőzné a vállad.',
  ],

  /* ==================================================================
     Hát
     ================================================================== */
  'Húzódzkodás': [
    'Fogd meg a rudat vállnál szélesebben, felső fogással, és lógj ki nyújtott karral.',
    'Indításként húzd le a lapockád — a mozgás onnan induljon, ne a karodból.',
    'Húzd fel magad, amíg az állad a rúd fölé ér, a könyököd a törzsed felé húzódjon.',
    'Engedd le magad lassan a teljesen nyújtott karig. Ne lendíts a lábaddal, ha erőből dolgozol.',
  ],
  'Alsó fogású húzódzkodás': [
    'Fogd meg a rudat vállszélességben, alsó (tenyérrel magad felé néző) fogással.',
    'Lógj ki nyújtott karral, a vállad húzd le a füledtől.',
    'Húzd fel magad, amíg az állad a rúd fölé ér — ez a fogás a bicepszet is jobban bevonja.',
    'Engedd le magad kontrolláltan, a végén teljesen nyújtsd ki a karod.',
  ],
  'Széles lehúzás': [
    'Állítsd be a combpárnát úgy, hogy a combod ne emelkedjen meg a húzás közben.',
    'Fogd meg a rudat vállnál szélesebben, és ülj le kinyújtott karral.',
    'Enyhén dőlj hátra, a mellkasod told ki, és húzd le a rudat a kulcscsontodhoz.',
    'A lapockád húzd össze a mélyponton, majd engedd vissza a rudat lassan a teljes nyújtásig.',
  ],
  'Ülő evezés': [
    'Ülj be, támaszd meg a lábad, és fogd meg a fogantyút enyhén hajlított térddel.',
    'A hátad legyen egyenes, a mellkasod kitolva — ez a testhelyzet ne változzon a sorozat alatt.',
    'Húzd a fogantyút a hasad felé, a könyököd szorosan a törzsed mellett haladjon.',
    'A végponton szorítsd össze a lapockád, majd engedd vissza a kart lassan, a törzsed előrebillentése nélkül.',
  ],
  'Hajolt evezés': [
    'Állj vállszéles terpeszben, fogd meg a rudat felső fogással, vállnál kicsit szélesebben.',
    'Döntsd előre a törzsed nagyjából 45 fokig, a térded enyhén hajlítva, a hátad EGYENES.',
    'Húzd a rudat a hasad alsó részéhez, a könyököd a törzsed mentén haladjon.',
    'Engedd vissza kontrolláltan a nyújtott karig. Ha a derekad kerekedni kezd, csökkentsd a súlyt.',
  ],
  'Egykezes kézisúlyzós evezés': [
    'Támaszd az egyik térded és azonos oldali kezed a padra, a másik lábad legyen a földön.',
    'A törzsed legyen nagyjából vízszintes és egyenes, a súlyzó lógjon nyújtott karral.',
    'Húzd fel a súlyzót a csípőd felé, a könyököd szorosan a törzsed mellett.',
    'A tetőponton szorítsd össze a lapockát, majd engedd le lassan. A törzsed ne forduljon el.',
  ],
  'Felhúzás': [
    'Állj a rúdhoz úgy, hogy az a lábközéped fölött legyen, a lábad csípőszélességben.',
    'Hajolj le csípőből, fogd meg a rudat vállszélességben, a mellkasod told ki, a hátad legyen egyenes.',
    'Feszítsd meg a hasad, told a padlót magadtól, és emeld a rudat a lábad mentén felfelé.',
    'A csípőd és a váll egyszerre emelkedjen; felül nyújtsd ki a csípőd, de ne dőlj hátra.',
    'Engedd vissza a rudat ugyanazon az úton, csípőből indítva. A hátad egyetlen ismétlésnél se kerekedjen.',
  ],
  'Román felhúzás': [
    'Állj csípőszéles terpeszben, a rudat tartsd a combod előtt nyújtott karral.',
    'Told hátra a csípőd, és eközben engedd a rudat a combod mentén lefelé — a térded csak enyhén hajlik.',
    'Addig menj, amíg erős nyújtást érzel a combhajlítóban, jellemzően a térd magasságáig.',
    'Told előre a csípőd, és emelkedj vissza álló helyzetbe. Végig tartsd a rudat közel a testedhez.',
  ],
  'Hiperextenzió': [
    'Állítsd be a gépet úgy, hogy a párna a csípőd hajlata alatt legyen.',
    'Fond keresztbe a karod a mellkasodon, a tested legyen egyenes vonal.',
    'Hajolj előre csípőből, amíg nyújtást érzel a combhajlítóban — a hátad ne kerekedjen.',
    'Emelkedj vissza, amíg a törzsed egy vonalba kerül a lábaddal. Ne feszítsd hátra magad a vízszintes fölé.',
  ],
  'Vállvonogatás': [
    'Állj egyenesen, a súlyzókat tartsd nyújtott karral a tested mellett.',
    'A karod maradjon végig nyújtva — ez nem húzás, hanem emelés.',
    'Emeld a vállad egyenesen felfelé, a füled felé, és tartsd meg egy pillanatra.',
    'Engedd vissza lassan a teljes nyújtásig. Ne körözz a válladdal.',
  ],

  /* ==================================================================
     Váll
     ================================================================== */
  'Vállból nyomás': [
    'Fogd meg a rudat vállnál kicsit szélesebben, és emeld a kulcscsontod magasságába.',
    'A talpad stabilan a földön, a hasad és a farizmod feszes, a bordád ne szaladjon ki előre.',
    'Told a rudat egyenesen felfelé a fejed fölé; ahogy elhalad a fejed mellett, told a fejed enyhén előre.',
    'Felül a rúd legyen a fejed fölött, ne előtte. Engedd vissza kontrolláltan a kulcscsontig.',
  ],
  'Katonai nyomás': [
    'Állj szoros, csípőszéles terpeszben, a rudat tartsd a kulcscsontodon.',
    'Feszítsd meg a hasad és a farizmod — ebben a változatban nincs lábsegítség.',
    'Told a rudat egyenesen a fejed fölé, a végén nyújtsd ki teljesen a karod.',
    'Engedd vissza lassan a kiinduló helyzetbe, a törzsed maradjon egyenes.',
  ],
  'Kézisúlyzós vállnyomás': [
    'Ülj vagy állj egyenesen, a súlyzókat emeld vállmagasságba, tenyérrel előre.',
    'A hasad legyen feszes, a derekad ne domborodjon hátra.',
    'Told a súlyzókat felfelé és kissé egymás felé, amíg a karod majdnem nyújtott.',
    'Engedd vissza őket vállmagasságig kontrolláltan.',
  ],
  'Arnold nyomás': [
    'Ülj egyenesen, a súlyzókat tartsd a mellkasod előtt, tenyérrel magad felé.',
    'Nyomás közben fordítsd ki a tenyered, hogy a mozgás tetején előre nézzen.',
    'Told a súlyzókat a fejed fölé, amíg a karod majdnem nyújtott.',
    'Ugyanezt az útvonalat fordítsd vissza lefelé, a tenyered újra magad felé forduljon.',
  ],
  'Oldalemelés': [
    'Állj egyenesen, a súlyzókat tartsd a tested mellett, enyhén hajlított könyökkel.',
    'Emeld a karod oldalra, amíg vállmagasságba nem ér — a könyök végig legyen a csukló fölött.',
    'Ne lendíts a törzseddel; ha muszáj, a súly túl nagy.',
    'Engedd vissza a karod lassan a tested mellé.',
  ],
  'Első emelés': [
    'Állj egyenesen, a súlyzókat tartsd a combod előtt, tenyérrel a tested felé.',
    'Emeld az egyik (vagy mindkét) karod előre, amíg vállmagasságba nem ér.',
    'A könyököd maradjon enyhén hajlítva, a törzsed ne dőljön hátra.',
    'Engedd vissza kontrolláltan, majd ismételd a másik oldallal.',
  ],
  'Hátsó vállemelés': [
    'Döntsd előre a törzsed csípőből, amíg majdnem vízszintes lesz, a súlyzók lógjanak lefelé.',
    'A hátad legyen egyenes, a térded enyhén hajlítva.',
    'Emeld a karod oldalra és kicsit hátra, enyhén hajlított könyökkel.',
    'A lapockád húzd össze a végponton, majd engedd vissza lassan.',
  ],
  'Face pull': [
    'Állítsd a csigát nagyjából arcmagasságba, és fogd meg a kötél két végét felső fogással.',
    'Lépj hátra, hogy legyen feszülés, a karod legyen kinyújtva előtted.',
    'Húzd a kötelet az arcod felé úgy, hogy a kezed szétnyíljon, a könyököd magasan maradjon.',
    'A végponton húzd hátra a lapockád, majd engedd vissza a kart lassan.',
  ],

  /* ==================================================================
     Kar
     ================================================================== */
  'Bicepsz hajlítás': [
    'Állj egyenesen, a rudat vagy a súlyzókat tartsd alsó fogással, nyújtott karral.',
    'A könyököd szorítsd a törzsed mellé — ez ne mozduljon el a sorozat alatt.',
    'Hajlítsd fel a súlyt a vállad felé, csak az alkarod mozogjon.',
    'A tetőponton szorítsd meg a bicepszet, majd engedd vissza lassan a teljes nyújtásig.',
  ],
  'Kalapács hajlítás': [
    'Állj egyenesen, a súlyzókat tartsd semleges fogással (tenyér befelé néz).',
    'A könyököd rögzítsd a törzsed mellé.',
    'Hajlítsd fel a súlyzót a vállad felé úgy, hogy a tenyered végig befelé nézzen.',
    'Engedd vissza lassan. Ez a fogás a karizmot és az alkart is jobban terheli.',
  ],
  'Koncentrált hajlítás': [
    'Ülj a pad szélére, terpeszben, és támaszd a felkarod a combod belső oldalához.',
    'A súlyzó lógjon nyújtott karral a lábad között.',
    'Hajlítsd fel a súlyzót a vállad felé, a felkarod végig maradjon a combon.',
    'Engedd vissza teljesen nyújtott karig, kontrolláltan.',
  ],
  'Scott-padon hajlítás': [
    'Állítsd be a padot úgy, hogy a hónaljad a párna tetején feküdjön.',
    'Fogd meg a rudat alsó fogással, a felkarod teljes hosszában támaszkodjon.',
    'Hajlítsd fel a rudat a vállad felé, a felkarod ne emelkedjen el a párnától.',
    'Engedd vissza lassan — a mélypontnál ne ejtsd hirtelen a súlyt, mert a könyök sérülékeny ebben a helyzetben.',
  ],
  'Tricepsz nyújtás': [
    'Állj a kábelgép elé, fogd meg a rudat felső fogással vállszélességben.',
    'A könyököd szorítsd a törzsed mellé, a törzsed enyhén dőljön előre.',
    'Nyomd le a rudat, amíg a karod teljesen ki nem nyúlik, a könyököd nem mozdul.',
    'Engedd vissza kontrolláltan, amíg az alkarod nagyjából vízszintes lesz.',
  ],
  'Köteles tricepsz nyújtás': [
    'Fogd meg a kötél két végét semleges fogással, a könyököd a törzsed mellett.',
    'Nyomd le a kötelet, és a végponton húzd szét a két végét egymástól.',
    'A tetőponton szorítsd meg a tricepszet egy pillanatra.',
    'Engedd vissza lassan, a könyököd végig maradjon a helyén.',
  ],
  'Homlok nyomás': [
    'Feküdj a padra, az EZ-rudat tartsd nyújtott karral a mellkasod fölött.',
    'Hajlítsd be a könyököd, és engedd a rudat a homlokod fölé — a felkarod maradjon mozdulatlan.',
    'A könyököd ne nyíljon szét oldalra a mozgás közben.',
    'Nyomd vissza a rudat a kiinduló pontig, csak a könyököt nyitva.',
  ],
  'Kickback': [
    'Döntsd előre a törzsed, támaszkodj meg a padon, a felkarod legyen párhuzamos a törzseddel.',
    'A könyököd rögzítsd ebben a helyzetben.',
    'Nyújtsd hátra az alkarod, amíg a karod teljesen egyenes lesz.',
    'Tartsd meg egy pillanatra, majd hajlítsd vissza lassan.',
  ],
  'Padon tolódzkodás': [
    'Ülj a pad szélére, a kezed a csípőd mellett fogja meg a padot, a lábad nyújtsd előre.',
    'Csúsztasd le a csípőd a pad elé, a karod tartsa a súlyod.',
    'Engedd le magad, amíg a felkarod nagyjából párhuzamos lesz a talajjal.',
    'Told vissza magad a kiinduló helyzetbe. Ha a vállad elöl fáj, csökkentsd a mélységet.',
  ],
  'Szűk fekvenyomás': [
    'Feküdj a padra, és fogd meg a rudat vállszélességben — ne szűkebben, mert az a csuklót terheli.',
    'Emeld ki a rudat a mellkasod fölé, a lapockád összehúzva.',
    'Engedd le a rudat a mellkasod aljára úgy, hogy a könyököd szorosan a törzsed mellett maradjon.',
    'Told vissza a rudat a kiinduló pontig, a tricepsz munkájára koncentrálva.',
  ],

  /* ==================================================================
     Láb
     ================================================================== */
  'Guggolás': [
    'Vedd le a rudat az állványról a csuklyás izmodra, és lépj hátra vállszéles terpeszbe.',
    'A lábfejed mutasson enyhén kifelé, a hasad legyen feszes, a mellkasod kitolva.',
    'Told hátra a csípőd és hajlítsd a térded egyszerre, mintha leülnél — a térded a lábfejed irányába nyíljon.',
    'Menj le legalább addig, amíg a combod párhuzamos lesz a talajjal, ha a mozgástartományod engedi.',
    'Told a padlót magadtól, és emelkedj vissza. A térded ne essen befelé, a hátad ne kerekedjen.',
  ],
  'Első guggolás': [
    'Fektesd a rudat a vállad elülső részére, a könyököd emeld magasra, előre.',
    'Lépj hátra vállszéles terpeszbe, a törzsed legyen egyenes.',
    'Guggolj le függőleges törzzsel — ha a könyököd leesik, a rúd előrebillen.',
    'Told vissza magad álló helyzetbe, végig magasan tartott könyökkel.',
  ],
  'Goblet guggolás': [
    'Fogj meg egy kézisúlyzót vagy kettlebellt függőlegesen a mellkasod előtt, két kézzel.',
    'Állj vállszéles terpeszben, a lábfejed enyhén kifelé.',
    'Guggolj le, a könyököd haladjon a térded belső oldala mellett.',
    'A mélyponton tarts egy pillanatot, majd told vissza magad álló helyzetbe.',
  ],
  'Kitörés': [
    'Állj egyenesen, a súlyzókat tartsd a tested mellett.',
    'Lépj előre egy nagy lépést, és engedd le a hátsó térded a talaj felé.',
    'Az elülső térded maradjon a bokád fölött, a törzsed legyen egyenes.',
    'Told vissza magad az elülső lábbal a kiinduló helyzetbe, majd válts lábat.',
  ],
  'Bolgár kitörés': [
    'Állj háttal egy padnak, és tedd fel rá az egyik lábad fejét.',
    'Az elülső lábad legyen elég messze, hogy a térded ne szaladjon túl a lábujjadon.',
    'Engedd le magad, amíg az elülső combod nagyjából párhuzamos lesz a talajjal.',
    'Told vissza magad az elülső sarkadról. Fejezd be a sorozatot, mielőtt lábat váltasz.',
  ],
  'Fellépés': [
    'Állj egy stabil doboz vagy pad elé, a súlyzókat tartsd a tested mellett.',
    'Lépj fel az egyik lábbal úgy, hogy a teljes talpad a felületen legyen.',
    'Told magad felfelé az elöl lévő lábbal — ne rugaszkodj el a hátsóval.',
    'Engedd le magad kontrolláltan ugyanazzal a lábbal, majd válts.',
  ],
  'Lábtolás': [
    'Ülj be a gépbe, a talpad legyen vállszélességben a lapon, a hátad a támlán.',
    'Told el a lapot, és oldd ki a biztonsági karokat.',
    'Engedd le a súlyt, amíg a térded nagyjából 90 fokban van — a farkad ne emelkedjen el az üléstől.',
    'Told vissza a lapot, de a térded ne akadjon be teljesen a végponton.',
  ],
  'Combnyújtás': [
    'Ülj be a gépbe, a párna a bokád előtt, közvetlenül a lábfejed fölött legyen.',
    'Fogd meg az oldalsó fogantyúkat, a hátad támaszkodjon.',
    'Nyújtsd ki a lábad, amíg majdnem egyenes lesz, és szorítsd meg a combizmot.',
    'Engedd vissza lassan a kiinduló helyzetbe.',
  ],
  'Combhajlítás': [
    'Feküdj hasra a gépen, a párna a vádlid alsó részén, az Achilles fölött legyen.',
    'Fogd meg a fogantyúkat, a csípőd maradjon a párnán.',
    'Hajlítsd be a térded, és húzd a párnát a farod felé.',
    'Engedd vissza kontrolláltan, majdnem teljes nyújtásig.',
  ],
  'Csípőtolás': [
    'Támaszd a lapockád egy padnak, a rudat tedd a csípőd hajlatába (párnával).',
    'A talpad legyen csípőszélességben, a térded nagyjából 90 fokban a felső helyzetben.',
    'Told a csípőd felfelé a sarkadból, amíg a törzsed vízszintes nem lesz.',
    'A tetőponton szorítsd meg a farizmot, az állad maradjon lefelé nézve. Engedd vissza kontrolláltan.',
  ],
  'Vádliemelés': [
    'Állj a lépcsőre vagy az emelvényre a lábfejed elülső részével, a sarkad lógjon le.',
    'Engedd le a sarkad, amíg nyújtást érzel a vádliban.',
    'Emelkedj fel a lábujjhegyre, amilyen magasra csak tudsz.',
    'Tarts egy pillanatot a tetőponton, majd engedd le lassan. Ne pattogj a mélyponton.',
  ],
  'Ülő vádliemelés': [
    'Ülj be a gépbe, a párna a combod alsó részén, közel a térdedhez legyen.',
    'A lábfejed elülső része legyen az emelvényen, a sarkad lógjon.',
    'Emelkedj fel a lábujjhegyre, és szorítsd meg a vádlit.',
    'Engedd le a sarkad teljes nyújtásig. Ez a változat inkább a mélyebb lábikraizmot terheli.',
  ],

  /* ==================================================================
     Törzs
     ================================================================== */
  'Plank': [
    'Támaszkodj az alkarodra és a lábujjadra, a könyököd a vállad alatt legyen.',
    'A tested legyen egyenes vonal a sarkadtól a fejedig.',
    'Feszítsd meg a hasad és a farizmod, a csípőd ne lógjon be és ne emelkedjen meg.',
    'Tartsd a helyzetet egyenletes légzéssel. Ha a derekad besüpped, fejezd be a sorozatot.',
  ],
  'Oldalplank': [
    'Feküdj az oldaladra, támaszkodj az alsó alkarodra, a könyököd a vállad alatt.',
    'Emeld meg a csípőd, hogy a tested egyenes vonalat alkosson.',
    'A felső kezed tedd a csípődre vagy nyújtsd a mennyezet felé.',
    'Tartsd a helyzetet, majd ismételd a másik oldalon is.',
  ],
  'Hasprés': [
    'Feküdj hanyatt, a térded hajlítva, a talpad a földön.',
    'A kezed tedd a halántékodhoz vagy keresztbe a mellkasodon — ne húzd a fejed.',
    'Gördítsd fel a felsőtested, amíg a lapockád elemelkedik a talajról.',
    'Engedd vissza lassan. A mozgás a hasizomból jöjjön, ne a nyakadból.',
  ],
  'Csavart hasprés': [
    'Feküdj hanyatt hajlított térddel, a kezed a halántékodnál.',
    'Emeld fel a felsőtested, és közben fordítsd az egyik könyököd az ellentétes térd felé.',
    'A mozgás végén szorítsd meg a ferde hasizmot.',
    'Engedd vissza kontrolláltan, és váltogasd az oldalakat.',
  ],
  'Fekvő lábemelés': [
    'Feküdj hanyatt, a kezed a csípőd mellett vagy a farod alatt.',
    'Nyomd a derekad a talajhoz — ez végig maradjon így.',
    'Emeld fel a nyújtott lábad, amíg merőleges nem lesz a talajra.',
    'Engedd le lassan, de ne tedd le teljesen a földre a sorozat közben.',
  ],
  'Függeszkedő lábemelés': [
    'Lógj ki a rúdon nyújtott karral, a vállad húzd le a füledtől.',
    'Feszítsd meg a hasad, hogy ne kezdj lengeni.',
    'Emeld fel a térded (vagy nyújtott lábad) a mellkasod felé, a csípőd kissé forduljon be a végén.',
    'Engedd vissza lassan, kontrollal — a lendület itt a leggyakoribb hiba.',
  ],
  'Orosz csavarás': [
    'Ülj a talajra hajlított térddel, és dőlj hátra, hogy a törzsed 45 fok körül legyen.',
    'A lábad lehet a talajon, vagy megemelve, ha nehezíteni akarod.',
    'Fordítsd a törzsed egyik oldalról a másikra, a kezed kövesse a mozgást.',
    'A mozgás a törzsből induljon, ne csak a karod lengjen. Tartsd a mellkasod kitolva.',
  ],
  'Dead bug': [
    'Feküdj hanyatt, a karod nyújtsd a mennyezet felé, a térded emeld 90 fokba.',
    'Nyomd a derekad a talajhoz, és tartsd ott végig.',
    'Nyújtsd ki az egyik karod a fejed fölé és az ellentétes lábad előre, egyszerre.',
    'Hozd vissza őket kontrolláltan, majd váltsd az oldalakat. Ha a derekad elemelkedik, ne menj olyan mélyre.',
  ],
  'Bird dog': [
    'Ereszkedj négykézlábra, a kezed a vállad alatt, a térded a csípőd alatt.',
    'A hátad legyen egyenes, a hasad feszes.',
    'Nyújtsd ki az egyik karod előre és az ellentétes lábad hátra, egy vonalba a törzseddel.',
    'Tarts egy pillanatot, majd hozd vissza őket, és válts oldalt. A csípőd ne billenjen el.',
  ],
  'Farmer séta': [
    'Vegyél fel két nehéz súlyzót a tested mellé, egyenes háttal, csípőből emelve.',
    'Állj fel, a vállad húzd hátra és le, a mellkasod kitolva.',
    'Sétálj egyenletes, rövid léptekkel, a törzsed ne dőljön oldalra.',
    'A megadott távolság vagy idő végén tedd le a súlyokat kontrolláltan, ugyanolyan egyenes háttal.',
  ],

  /* ==================================================================
     Kardió
     ================================================================== */
  'Burpee': [
    'Állj egyenesen, majd guggolj le, és tedd a kezed a talajra a lábad elé.',
    'Ugord vagy lépd hátra a lábad fekvőtámasz helyzetbe.',
    'Végezz egy fekvőtámaszt (vagy hagyd ki, ha könnyíteni akarsz).',
    'Ugord vissza a lábad a kezedhez, majd robbanj fel egy ugrásba, kezekkel a fejed fölött.',
  ],
  'Ugrálókötél': [
    'Állj egyenesen, a könyököd a törzsed mellett, a kötél a sarkad mögött.',
    'A csuklódból forgasd a kötelet, ne a válladból.',
    'Ugorj kicsit — épp csak annyit, hogy a kötél elférjen alattad.',
    'Érkezz a lábujjadra puhán, enyhén hajlított térddel.',
  ],
  'Kettlebell swing': [
    'Állj vállszéles terpeszben, a kettlebell legyen egy lépésre előtted a talajon.',
    'Csípőből hajolva fogd meg, és lendítsd hátra a lábad közé („hajtsd be az ágyékodhoz”).',
    'Robbanékonyan told előre a csípőd, és ettől lendüljön fel a súly mellmagasságig.',
    'A kar csak követi a mozgást — ez csípőmozgás, nem vállemelés. Engedd visszalendülni, és ismételd.',
  ],
  'Box jump': [
    'Állj a doboz elé nagyjából egy lépésre, vállszéles terpeszben.',
    'Hajlíts térdet és csípőt, a karod lendítsd hátra.',
    'Robbanj fel, és érkezz a doboz tetejére puhán, hajlított térddel.',
    'Állj fel teljesen, majd LÉPJ le a dobozról — ne ugorj vissza, mert az terheli az Achillest.',
  ],
  'Jumping jack': [
    'Állj egyenesen, a lábad zárva, a karod a tested mellett.',
    'Ugorj terpeszbe, és közben lendítsd a karod a fejed fölé.',
    'Ugorj vissza a kiinduló helyzetbe, a karod le a tested mellé.',
    'Tartsd egyenletesen a ritmust, és érkezz puhán a lábujjadra.',
  ],
  'Magas térdemelés': [
    'Állj egyenesen, a karod hajlítsd 90 fokba a tested mellett.',
    'Fuss helyben, és emeld a térded csípőmagasságig.',
    'A törzsed maradjon egyenes, ne dőlj hátra.',
    'Érkezz a lábfejed elülső részére, és tartsd gyorsan a ritmust.',
  ],
};
